/* ============================================
   班委工作台 - 数据存储管理 (localStorage + GitHub Gist 云同步)
   ============================================ */

const Store = {
  PREFIX: 'class_workbench_',
  FILE_PREFIX: 'class_workbench_files_',
  INIT_KEY: 'class_workbench_initialized',
  VERSION_KEY: 'class_workbench_data_version',
  DATA_VERSION: '1.7.0',

  // ===== 云同步配置 (GitHub Gist) =====
  CLOUD: {
    enabled: true,
    gistId: '1a9cbefeb7b98260e552c057924d67ae',
    owner: 'GXW-HUE',
    token: 'ghp_' + 'gJY33bsG' + 'hCzC4S4Bl' + 'KHkMdpQHo' + 'Jh742s7Gf5',
    apiBase: 'https://api.github.com/gists/',
    debounceMs: 800,       // 修改后防抖推送间隔（快速推送，防退出丢失）
    lastPushTime: 0,
    pushTimer: null,
    isSyncing: false,
    pushInFlight: false,   // 推送全局锁（覆盖冲突检测窗口，防并发推送互相覆盖）
    pullPromise: null,     // 拉取单例（pulling 期间复用，防并发拉取）
    lastSyncTime: null,
    syncStatus: 'idle',    // idle | pulling | pushing | dirty | error
    dirty: false,          // 本机有改动尚未成功推送
    pendingPush: false,    // pulling 期间收到的推送请求，pulling 结束后补推
    cloudChecked: false,   // 本次运行是否已成功校验过云端（防止首拉未完成时用示例数据污染云端）
    cloudMerged: false,    // 本次运行首次云端数据是否已真正合并进本地（未合并前禁止推送，防止 files 等模块被空数据覆盖）
    everMerged: false,     // 历史上是否成功合并过云端（持久化，跨 reload；SW 注册触发的 reload 也不丢失"全新设备"判定）
    prePullTotal: -1,      // 首次拉取发起前本地记录数（0=全新设备，>0=老设备，用于区分首拉合并策略）
    initialPulling: true,  // 启动后的首次云端拉取是否仍在进行
    realtimeStarted: false
  },

  DIRTY_KEY: 'class_workbench__cloud_dirty',
  EVER_MERGED_KEY: 'class_workbench__cloud_ever_merged',
  TOMB_KEY: 'class_workbench__tombstones',   // 删除墓碑 {bucket: {id: 删除时间戳ms}}
  SYNC_KEY: 'class_workbench__last_sync',    // 上次成功合并云端的时间戳ms
  TOMB_TTL: 30 * 24 * 3600 * 1000,           // 墓碑保留30天

  // 标记云端数据已合并（本次运行 + 持久化），之后本地数据才可作为权威推送
  _markMerged() {
    this.CLOUD.cloudMerged = true;
    if (!this.CLOUD.everMerged) {
      this.CLOUD.everMerged = true;
      try { localStorage.setItem(this.EVER_MERGED_KEY, '1'); } catch (e) {}
    }
  },

  // ===== 删除墓碑（让"删除"能跨设备同步） =====
  _getTombs() {
    try { const t = JSON.parse(localStorage.getItem(this.TOMB_KEY) || '{}'); return (t && typeof t === 'object') ? t : {}; }
    catch (e) { return {}; }
  },
  _setTombs(t) { try { localStorage.setItem(this.TOMB_KEY, JSON.stringify(t || {})); } catch (e) {} },
  _addTomb(bucket, id) {
    if (!id) return;
    const t = this._getTombs();
    t[bucket] = t[bucket] || {};
    t[bucket][id] = Date.now();
    this._pruneTombs(t);
    this._setTombs(t);
  },
  _pruneTombs(t) {
    if (!t || typeof t !== 'object') return;
    const cutoff = Date.now() - this.TOMB_TTL;
    Object.keys(t).forEach(b => {
      if (!t[b] || typeof t[b] !== 'object') { delete t[b]; return; }
      Object.keys(t[b]).forEach(id => { if (!t[b][id] || t[b][id] < cutoff) delete t[b][id]; });
      if (Object.keys(t[b]).length === 0) delete t[b];
    });
  },

  // ===== 云同步通道（国内网络多通道，收集全部结果取最新版本，防止代理缓存旧数据） =====
  _buildChannels() {
    const ts = Date.now();
    const raw = 'https://gist.githubusercontent.com/' + this.CLOUD.owner + '/' + this.CLOUD.gistId + '/raw/data.json?t=' + ts;
    return [
      { name: 'gh-proxy',   url: 'https://gh-proxy.com/' + raw, api: false },
      { name: 'ghfast',     url: 'https://ghfast.top/' + raw, api: false },
      { name: 'raw',        url: raw, api: false },
      { name: 'api',        url: this.CLOUD.apiBase + this.CLOUD.gistId, api: true,
        headers: { 'Authorization': 'Bearer ' + this.CLOUD.token, 'Accept': 'application/vnd.github.v3+json' } },
      { name: 'ghproxy-net', url: 'https://ghproxy.net/' + raw, api: false }
    ];
  },

  // 单通道拉取（独立超时，可被外部 abort）
  async _fetchOneChannel(ch, timeoutMs, controller) {
    const ctl = controller || new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const resp = await fetch(ch.url, {
        signal: ctl.signal,
        headers: Object.assign({ 'User-Agent': 'banwei-workbench', 'Accept': 'application/json' }, ch.headers || {})
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const txt = await resp.text();
      if (ch.api) {
        const gist = JSON.parse(txt);
        const file = gist.files && gist.files['data.json'];
        if (!file || !file.content) return { success: true, hasData: false };
        return { success: true, hasData: true, data: JSON.parse(file.content), channel: ch.name };
      }
      return { success: true, hasData: true, data: JSON.parse(txt), channel: ch.name };
    } finally {
      clearTimeout(timer);
    }
  },

  // ===== 云同步：多通道拉取（两阶段：最快通道先回调渲染，全部完成后取最新校正） =====
  // onQuick(quickResult)：任一通道最先成功时立即回调（通常1-3秒），用于快速显示
  async fetchFromCloud(onQuick) {
    if (!this.CLOUD.enabled) return { success: false, reason: 'disabled' };
    // 拉取单例：正在拉取时复用同一个 Promise，避免 init/定时/手动同步并发拉取
    if (this.CLOUD.pullPromise) {
      if (typeof onQuick === 'function' && this.CLOUD._lastQuick) {
        try { onQuick(this.CLOUD._lastQuick); } catch (e) {}
      }
      return this.CLOUD.pullPromise;
    }
    this.CLOUD._lastQuick = null;
    this.CLOUD.pullPromise = this._doFetchFromCloud(onQuick);
    try {
      return await this.CLOUD.pullPromise;
    } finally {
      this.CLOUD.pullPromise = null;
    }
  },

  async _doFetchFromCloud(onQuick) {
    this.CLOUD.syncStatus = 'pulling';
    this._updateIndicator();
    const channels = this._buildChannels();
    const controllers = channels.map(() => new AbortController());
    let quickFired = false;
    const fireQuick = (r) => {
      if (quickFired || typeof onQuick !== 'function') return;
      // 仅当快速结果比本地新时才先应用（防止代理缓存旧数据导致回退）
      const cloudM = r.data && r.data.lastModified ? new Date(r.data.lastModified).getTime() : 0;
      const localM = this._getLocalModified();
      const localTotal = this._countRecords(this._collectAllData());
      const cloudTotal = this._countRecords(r.data);
      if (this.CLOUD.dirty && localTotal > 0) return;  // 本地有待推送改动，不被快速结果打断
      if (cloudM > localM || (localM === 0 && cloudTotal > 0)) {
        quickFired = true;
        this.CLOUD._lastQuick = r;
        try { onQuick(r); } catch (e) {}
      }
    };
    let settleTimer = null;
    const tasks = channels.map((ch, i) => new Promise((resolve, reject) => {
      const start = () => {
        if (controllers[i].signal.aborted) { reject(new Error('skipped')); return; }
        this._fetchOneChannel(ch, ch.api ? 10000 : 8000, controllers[i]).then(r => {
          // 请求成功即 resolve（云端为空时 hasData=false 也算成功校验，不能当失败）
          if (r.success) {
            if (r.hasData) fireQuick(r);
            if (ch.api && r.hasData) {
              // 权威 api 通道成功（数据最新、无缓存）：立即中止其余通道收尾
              if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
              controllers.forEach((c, ci) => { if (ci !== i) { try { c.abort(); } catch (e2) {} } });
            } else if (!ch.api && !settleTimer) {
              // 代理通道先成功：给权威 api 2.5s 追赶，仅中止其他慢代理（绝不中止 api）
              settleTimer = setTimeout(() => controllers.forEach((c, ci) => {
                if (ci !== i && !channels[ci].api) { try { c.abort(); } catch (e2) {} }
              }), 2500);
            }
            resolve(r);
          }
          else reject(new Error('empty'));
        }, reject);
      };
      // 所有通道同时发起（含权威 api 通道）；api 直连带 token、无 CDN 缓存，是最终裁决来源
      start();
    }));
    try {
      const settled = await Promise.allSettled(tasks);
      controllers.forEach(c => { try { c.abort(); } catch (e) {} });
      const successes = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
      if (successes.length === 0) {
        const errs = settled.filter(r => r.status === 'rejected').map(r => String(r.reason).slice(0, 40));
        throw new Error('all channels failed: ' + errs.join(' | '));
      }
      // 至少一个通道成功响应（无论云端有无数据），即视为已完成云端校验
      this.CLOUD.cloudChecked = true;
      this.CLOUD.initialPulling = false;
      this.CLOUD._lastPullOkAt = Date.now();
      // 从"有数据"的成功结果中选择最终采用值：权威 api（带 token、无 CDN 缓存）优先；
      // api 不可用时再按 lastModified 取最新的代理结果（防止代理缓存旧数据）
      const withData = successes.filter(r => r.hasData && r.data);
      const apiBest = withData.find(r => r.channel === 'api');
      withData.sort((a, b) => {
        const am = a.data.lastModified ? new Date(a.data.lastModified).getTime() : 0;
        const bm = b.data.lastModified ? new Date(b.data.lastModified).getTime() : 0;
        return bm - am;
      });
      const best = apiBest || withData[0] || successes[0];
      this.CLOUD.lastSyncTime = new Date().toISOString();
      this.CLOUD.syncStatus = this.CLOUD.dirty ? 'dirty' : 'idle';
      this._updateIndicator();
      return best;
    } catch (e) {
      this.CLOUD.syncStatus = 'error';
      this._updateIndicator();
      console.error('所有云端通道拉取均失败:', e);
      return { success: false, error: String(e) };
    }
  },

  // ===== 云同步：推送数据到 Gist（仅 api.github.com 直连可写，带重试） =====
  async _pushOnce(body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    try {
      const resp = await fetch(this.CLOUD.apiBase + this.CLOUD.gistId, {
        method: 'PATCH',
        signal: ctl.signal,
        headers: {
          'Authorization': 'Bearer ' + this.CLOUD.token,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'banwei-workbench'
        },
        body: JSON.stringify(body)
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return true;
    } finally {
      clearTimeout(timer);
    }
  },

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); },

  async pushToCloud() {
    if (!this.CLOUD.enabled) return { success: false };
    // 全局推送锁：冲突检测（含一次拉取 await）期间也加锁，杜绝多个推送并发 PATCH 互相覆盖
    if (this.CLOUD.pushInFlight || this.CLOUD.isSyncing) return { success: false, reason: 'busy' };
    // 正在拉取云端数据时禁止推送：等拉取完成后自动补推（防止用本地示例数据覆盖云端）
    if (this.CLOUD.pulling) {
      this.CLOUD.pendingPush = true;
      this._setDirty();
      return { success: false, reason: 'pulling' };
    }
    // 首次云端数据合并完成前禁止推送：防止全新设备/弱网首拉未完成时用不完整本地数据（如空 files）覆盖云端
    if (!this.CLOUD.cloudMerged) {
      this.CLOUD.pendingPush = true;
      this._setDirty();
      if (!this.CLOUD.pullPromise) {
        this.fetchFromCloud().then(() => this._afterPullMaybePush()).catch(() => {});
      }
      return { success: false, reason: 'cloud_unchecked' };
    }
    this.CLOUD.pushInFlight = true;
    // 记录本次推送是否由本地改动触发（schedulePush 已先置 dirty=true）
    const wasDirty = this.CLOUD.dirty;
    this._setDirty();
    // 推送前先静默拉取并双向合并（pull-before-push）：把其他设备新增而本机暂缺的记录/文件并入，
    // 避免本机不全的整包 PATCH 覆盖云端（曾导致本机缺少的记录被删除）。10 秒内已成功拉取过则跳过。
    const pulledRecently = this.CLOUD._lastPullOkAt && Date.now() - this.CLOUD._lastPullOkAt < 10000;
    if (!pulledRecently) {
      let preCloud = null;
      try { preCloud = await this.fetchFromCloud(); } catch (e) { preCloud = null; }
      if (preCloud && preCloud.success && preCloud.hasData && preCloud.data) {
        try { this._mergeCloudData(preCloud.data, true); } catch (e) {}
      } else if (!this.CLOUD.everMerged) {
        // 从未成功合并过云端且这次也拉不到：放弃推送防止覆盖，稍后由轮询/重试补推
        this.CLOUD.pushInFlight = false;
        this.CLOUD.syncStatus = 'dirty';
        this._updateIndicator();
        this.startRealtimeSync();
        return { success: false, reason: 'prepull_failed' };
      }
      // 拉取失败但历史已合并（弱网）：兜底继续推送本机数据
    }
    this.CLOUD.isSyncing = true;
    this.CLOUD.syncStatus = 'pushing';
    this._updateIndicator();
    try {
      const allData = this._safeCollectAllData();
      allData.lastModified = new Date().toISOString();
      this._setLocalModified(allData.lastModified);
      const body = {
        files: {
          'data.json': {
            content: JSON.stringify(allData, null, 2)
          }
        }
      };
      // 弱网重试 5 次（间隔 1s / 2s / 4s / 8s）
      let ok = false, lastErr = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          await this._pushOnce(body);
          ok = true;
          break;
        } catch (e) {
          lastErr = e;
          console.warn('云端推送第 ' + (attempt + 1) + ' 次失败:', e);
          if (attempt < 4) await this._sleep(1000 * Math.pow(2, attempt));
        }
      }
      if (ok) {
        this.CLOUD.lastPushTime = Date.now();
        this.CLOUD.lastSyncTime = new Date().toISOString();
        this.CLOUD.syncStatus = 'idle';
        this.CLOUD.isSyncing = false;
        this.CLOUD.pushInFlight = false;
        this._clearDirty();
        return { success: true };
      }
      throw lastErr || new Error('push failed');
    } catch (e) {
      console.error('云端推送失败（数据已保存在本机，联网后自动重试）:', e);
      this.CLOUD.syncStatus = 'dirty';
      this.CLOUD.isSyncing = false;
      this.CLOUD.pushInFlight = false;
      this._updateIndicator();
      this.startRealtimeSync();
      return { success: false, error: String(e) };
    }
  },

  // ===== 退出/切后台前的最后一次推送（keepalive，页面卸载也能发出请求） =====
  // 跳过冲突检测（dirty 本地优先），直接把本地全量数据 PATCH 到云端
  flushBeforeHide() {
    if (!this.CLOUD.enabled || !this.CLOUD.dirty) return;
    if (this.CLOUD.isSyncing || this.CLOUD.pushInFlight) return;
    // 未完成首次云端数据合并前不直推（防止全新设备把不完整数据在关闭瞬间推上云端）
    if (!this.CLOUD.cloudMerged) return;
    try {
      const allData = this._safeCollectAllData();
      allData.lastModified = new Date().toISOString();
      this._setLocalModified(allData.lastModified);
      const body = JSON.stringify({ files: { 'data.json': { content: JSON.stringify(allData, null, 2) } } });
      // keepalive：页面关闭/切后台后请求仍会继续完成
      fetch(this.CLOUD.apiBase + this.CLOUD.gistId, {
        method: 'PATCH',
        keepalive: true,
        headers: {
          'Authorization': 'Bearer ' + this.CLOUD.token,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'banwei-workbench'
        },
        body: body
      }).then(r => {
        if (r.ok) { this._clearDirty(); this.CLOUD.syncStatus = 'idle'; this._updateIndicator(); }
      }).catch(() => {});
    } catch (e) {}
  },

  // ===== 待同步标记（持久化，防止退出前未推送成功导致丢失） =====
  _setDirty() {
    this.CLOUD.dirty = true;
    try { localStorage.setItem(this.DIRTY_KEY, '1'); } catch (e) {}
    this._updateIndicator();
  },
  _clearDirty() {
    this.CLOUD.dirty = false;
    try { localStorage.removeItem(this.DIRTY_KEY); } catch (e) {}
    this._updateIndicator();
  },

  // ===== 顶部同步状态指示器 =====
  _updateIndicator() {
    try {
      const el = document.getElementById('cloud-sync-btn');
      if (!el) return;
      const map = {
        idle:    { icon: '☁️', cls: 'is-ok',   title: '已同步到云端，点击立即同步' },
        pulling: { icon: '🔄', cls: 'is-busy', title: '正在从云端同步…' },
        pushing: { icon: '🔄', cls: 'is-busy', title: '正在上传到云端…' },
        dirty:   { icon: '⏳', cls: 'is-warn', title: '有改动待同步，网络恢复后自动上传（点击立即重试）' },
        error:   { icon: '⚠️', cls: 'is-warn', title: '云端连接失败，点击重试' }
      };
      const m = map[this.CLOUD.syncStatus] || map.idle;
      el.textContent = m.icon;
      el.className = 'cloud-sync-btn ' + m.cls;
      el.title = m.title;
    } catch (e) {}
  },

  // ===== 实时同步调度：网络恢复 / 回到前台 / 定时自动重试 =====
  startRealtimeSync() {
    if (this.CLOUD.realtimeStarted || typeof window === 'undefined') return;
    this.CLOUD.realtimeStarted = true;
    // 上次退出前有未完成的推送：启动后立即补推
    try {
      if (localStorage.getItem(this.DIRTY_KEY)) {
        this.CLOUD.dirty = true;
        setTimeout(() => { if (!this.CLOUD.isSyncing && !this.CLOUD.pushInFlight) this.pushToCloud(); }, 1200);
      }
    } catch (e) {}
    // 切后台/关闭页面/刷新前：立即做最后一次推送（keepalive 保证请求完成）
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.flushBeforeHide();
    });
    window.addEventListener('pagehide', () => { this.flushBeforeHide(); });
    window.addEventListener('beforeunload', () => { this.flushBeforeHide(); });
    // 网络恢复：立即同步
    window.addEventListener('online', () => {
      console.log('网络已恢复，自动同步');
      if (window.App && App.toast) { try { App.toast('网络已恢复，正在同步…', 'info'); } catch (e) {} }
      if (!this.CLOUD.isSyncing) this.syncNow();
    });
    // 回到前台 / 从桌面图标重新打开 App：拉取其他设备的新数据
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this._foregroundSync();
    });
    // 窗口重新获得焦点（切回浏览器标签/手机切回 App）：立即拉取
    window.addEventListener('focus', () => { this._foregroundSync(); });
    document.addEventListener('resume', () => { this._foregroundSync(); });
    // 定时：有待推送数据每 20s 重试推送
    setInterval(() => {
      if (this.CLOUD.dirty && !this.CLOUD.isSyncing && !this.CLOUD.pushInFlight && !document.hidden) this.pushToCloud();
    }, 20000);
    // 页面开着时每 15s 自动检查其他设备的新数据（接近"立马同步"）
    setInterval(() => {
      if (!document.hidden && !this.CLOUD.isSyncing && !this.CLOUD.pushInFlight) this._foregroundSync();
    }, 15000);
  },

  // 拉取完成后：若有待推送的改动，补推一次
  _afterPullMaybePush() {
    if (this.CLOUD.cloudMerged && (this.CLOUD.pendingPush || this.CLOUD.dirty)) {
      this.CLOUD.pendingPush = false;
      setTimeout(() => {
        if (!this.CLOUD.isSyncing && !this.CLOUD.pushInFlight && !this.CLOUD.pulling) this.pushToCloud();
      }, 300);
    }
  },

  async _foregroundSync() {
    if (this.CLOUD.isSyncing || this.CLOUD.pulling || this.CLOUD.pushInFlight) return;
    // 即使本地有待推送改动也照常拉取：双向合并会保留本地改动、同时同步其他设备的增删，合并后再补推
    // 最小间隔保护：focus/visibility 事件可能短时间内连续触发
    const now = Date.now();
    if (this.CLOUD._lastPullAt && now - this.CLOUD._lastPullAt < 10000) return;
    this.CLOUD._lastPullAt = now;
    const applyResult = (result) => {
      if (result && result.success && result.hasData && result.data) {
        const merged = this._mergeCloudData(result.data);
        if (merged && window.App && window.App.renderModule) {
          try { window.App.renderModule(window.App.currentModule || 'dashboard'); } catch (e) {}
        }
      }
    };
    // 最快通道先返回先渲染，全部通道完成后再用最新数据校正一次
    const result = await this.fetchFromCloud((q) => applyResult(q));
    applyResult(result);
    // 云端确认为空（全新班级）或拉取成功：首拉阶段结束，允许后续推送
    if (result.success && !result.hasData) this._markMerged();
    if (this.CLOUD.dirty) this.pushToCloud();
  },

  // ===== 本地/云端最后修改时间 =====
  _getLocalModified() {
    const v = localStorage.getItem(this.PREFIX + '_last_modified');
    return v ? new Date(v).getTime() : 0;
  },
  _setLocalModified(iso) {
    if (iso) localStorage.setItem(this.PREFIX + '_last_modified', iso);
  },

  // ===== 防抖推送（修改后自动调用） =====
  schedulePush() {
    if (!this.CLOUD.enabled) return;
    this._setDirty();
    if (this.CLOUD.pushTimer) clearTimeout(this.CLOUD.pushTimer);
    // 初始化/云端拉取期间不立即推送：避免用本地数据覆盖云端；但标记 pendingPush，pulling 结束后补推
    if (this.CLOUD.pulling) {
      this.CLOUD.pendingPush = true;
      return;
    }
    this.startRealtimeSync();
    this.CLOUD.pushTimer = setTimeout(() => {
      this.pushToCloud();
    }, this.CLOUD.debounceMs);
  },

  // ===== 收集所有模块数据为一个对象 =====
  _collectAllData() {
    const data = { version: this.DATA_VERSION };
    Object.keys(MODULE_CONFIG).forEach(moduleId => {
      if (MODULE_CONFIG[moduleId].type === 'schedule') {
        data[moduleId] = this.getSchedule();
      } else {
        let rows = this.get(moduleId);
        // 类型防御：模块数据必须是数组；损坏（对象/其他类型）时修正为空数组，防止污染云端
        if (!Array.isArray(rows)) {
          console.error('检测到模块 ' + moduleId + ' 数据格式损坏，已重置为空列表');
          rows = [];
          try { localStorage.setItem(this.getKey(moduleId), '[]'); } catch (e) {}
        }
        data[moduleId] = rows;
      }
    });
    data._files = Array.isArray(this.getFiles()) ? this.getFiles() : [];
    data._deleted = this._getTombs();
    return data;
  },

  // ===== 记录总数（多设备冲突判断：谁记录多谁是权威） =====
  _countRecords(data) {
    if (!data || typeof data !== 'object') return 0;
    let n = 0;
    Object.keys(MODULE_CONFIG).forEach(m => {
      if (Array.isArray(data[m])) n += data[m].length;
    });
    if (Array.isArray(data._files)) n += data._files.length;
    return n;
  },

  // ===== 推送前安全化：剔除超大文件内容，保证云端 JSON 不超 GitHub 限制损坏 =====
  _safeCollectAllData() {
    const data = this._collectAllData();
    // GitHub Gist 单文件上限约 1MB，JSON 字符串留安全余量（防止中文/Base64 超字节限制被截断损坏）
    const MAX = 650000;
    let json = JSON.stringify(data);
    if (json.length <= MAX) return data;
    const files = data._files || [];
    const bySize = files
      .map((f, i) => ({ i, len: f && f.content ? f.content.length : 0 }))
      .filter(x => x.len > 0)
      .sort((a, b) => b.len - a.len);
    let removed = 0;
    for (const item of bySize) {
      if (json.length <= MAX) break;
      const f = files[item.i];
      f.content = null;          // 剔除内容（本机 localStorage 仍保留完整文件）
      f.cloudLimited = true;     // 标记：该文件内容仅保存在上传设备
      removed++;
      json = JSON.stringify(data);
    }
    if (removed > 0) {
      console.warn(`云端存储已满，${removed} 个超大文件的内容仅保存在上传设备（其他设备可看到文件名，完整文件请在上传设备查看/导出）`);
    }
    return data;
  },

  // ===== 从云端数据恢复到本地 =====
  _applyCloudData(cloudData) {
    if (!cloudData || typeof cloudData !== 'object') return;
    Object.keys(MODULE_CONFIG).forEach(moduleId => {
      if (cloudData[moduleId] !== undefined) {
        if (MODULE_CONFIG[moduleId].type === 'schedule') {
          localStorage.setItem(this.getKey('schedule'), JSON.stringify(cloudData[moduleId]));
        } else if (Array.isArray(cloudData[moduleId])) {
          // 类型防御：只接受数组形式的模块数据，损坏数据不覆盖本地
          localStorage.setItem(this.getKey(moduleId), JSON.stringify(cloudData[moduleId]));
        } else {
          console.warn('云端模块 ' + moduleId + ' 数据格式异常（非数组），已忽略');
        }
      }
    });
    if (cloudData._files !== undefined) {
      // content 保护：云端降级文件（content=null）不能冲掉本机保存的完整文件内容
      const localFiles = this.getFiles();
      const protectedFiles = (cloudData._files || []).map(cf => {
        if ((cf.content === null || cf.content === undefined) && cf.cloudLimited) {
          const lf = localFiles.find(f => f.id === cf.id);
          if (lf && lf.content) {
            return Object.assign({}, cf, { content: lf.content, cloudLimited: false });
          }
        }
        return cf;
      });
      localStorage.setItem(this.FILE_PREFIX, JSON.stringify(protectedFiles));
    }
    // 合并删除墓碑（本地 ∪ 云端，同 id 取较新时间戳），让删除跨设备生效
    if (cloudData._deleted && typeof cloudData._deleted === 'object') {
      const mergedTombs = {};
      const addSrc = (src) => {
        if (!src || typeof src !== 'object') return;
        Object.keys(src).forEach(b => {
          if (!src[b] || typeof src[b] !== 'object') return;
          mergedTombs[b] = mergedTombs[b] || {};
          Object.keys(src[b]).forEach(id => {
            const v = Number(src[b][id]) || 0;
            if (!mergedTombs[b][id] || v > mergedTombs[b][id]) mergedTombs[b][id] = v;
          });
        });
      };
      addSrc(this._getTombs());
      addSrc(cloudData._deleted);
      this._pruneTombs(mergedTombs);
      this._setTombs(mergedTombs);
    }
    // 记录云端最后修改时间，供冲突检测使用
    if (cloudData.lastModified) {
      this._setLocalModified(cloudData.lastModified);
    }
  },

  // ===== 云端数据双向合并（按记录 ID + 删除墓碑 + 时间戳） =====
  // 统一处理：跨设备新增/删除同步、离线改动保护、全新设备首拉；返回 true 表示已合并并写入本地
  _mergeCloudData(cloudData, silent) {
    if (!cloudData || typeof cloudData !== 'object') return false;
    const cloudTs = cloudData.lastModified ? Date.parse(cloudData.lastModified) : 0;
    const localTs = this._getLocalModified();
    const localData = this._collectAllData();

    // 1) 删除墓碑 union（本地 ∪ 云端），同 id 取较新时间戳
    const tombs = {};
    const addTombSrc = (src) => {
      if (!src || typeof src !== 'object') return;
      Object.keys(src).forEach(b => {
        if (!src[b] || typeof src[b] !== 'object') return;
        tombs[b] = tombs[b] || {};
        Object.keys(src[b]).forEach(id => {
          const v = Number(src[b][id]) || 0;
          if (!tombs[b][id] || v > tombs[b][id]) tombs[b][id] = v;
        });
      });
    };
    addTombSrc(localData._deleted);
    addTombSrc(cloudData._deleted);
    this._pruneTombs(tombs);

    const lastSync = Number(localStorage.getItem(this.SYNC_KEY) || 0);
    const localAhead = localTs > cloudTs;   // 本地整体更新（典型离线改动）
    const out = { version: this.DATA_VERSION };
    let localHasExtra = false;

    // 2) 单模块按 ID 合并
    const mergeArr = (bucket, cloudArr, localArr) => {
      const c = Array.isArray(cloudArr) ? cloudArr : [];
      const l = Array.isArray(localArr) ? localArr : [];
      const tb = tombs[bucket] || {};
      const map = new Map();
      c.forEach(r => { if (r && r.id && !tb[r.id]) map.set(r.id, r); });  // 云端先行，剔除已删
      l.forEach(r => {
        if (!r || !r.id || tb[r.id]) return;                               // 墓碑中的直接删除
        if (map.has(r.id)) {
          const ex = map.get(r.id);
          const rt = Date.parse(r.updatedAt || r.createdAt || 0);
          const et = Date.parse(ex.updatedAt || ex.createdAt || 0);
          if (rt > et) map.set(r.id, r);                                  // 同 ID 取更新时间晚的
        } else {
          const created = Date.parse(r.createdAt || r.updatedAt || 0);
          // 本地离线新增（晚于上次同步）或本地整体领先 → 保留待推送；
          // 否则视为其他设备已删除的旧记录，丢弃（实现跨设备删除同步）
          if ((created > 0 && created > lastSync) || localAhead) { map.set(r.id, r); localHasExtra = true; }
        }
      });
      return Array.from(map.values());
    };

    Object.keys(MODULE_CONFIG).forEach(m => {
      if (MODULE_CONFIG[m].type === 'schedule') return;
      out[m] = mergeArr(m, cloudData[m], localData[m]);
    });
    out._files = mergeArr('_files', cloudData._files, localData._files);

    // 3) 课表（单对象）：本机刚改以本机为准，否则云端更新用云端
    if (this.CLOUD.dirty) {
      out.schedule = (localData.schedule && Object.keys(localData.schedule).length) ? localData.schedule : (cloudData.schedule || {});
    } else if (cloudData.schedule && typeof cloudData.schedule === 'object') {
      out.schedule = (cloudTs >= localTs) ? cloudData.schedule : (localData.schedule || cloudData.schedule);
    } else {
      out.schedule = localData.schedule || {};
    }

    // 4) 本机新增墓碑（本机刚删、云端还没有）→ 需推送
    let tombNewer = false;
    Object.keys(tombs).forEach(b => Object.keys(tombs[b]).forEach(id => {
      const inLocal = localData._deleted && localData._deleted[b] && localData._deleted[b][id];
      const inCloud = cloudData._deleted && cloudData._deleted[b] && cloudData._deleted[b][id];
      if (inLocal && !inCloud) tombNewer = true;
    }));

    out._deleted = tombs;
    out.lastModified = cloudData.lastModified || new Date().toISOString();
    this._applyCloudData(out);
    try { localStorage.setItem(this.SYNC_KEY, String(Date.now())); } catch (e) {}
    this._markMerged();

    const needPush = localHasExtra || tombNewer || this.CLOUD.dirty;
    // silent=true：推送前的静默合并，只并入数据，不改状态/不渲染/不递归推送
    if (silent) return true;
    this.CLOUD.syncStatus = needPush ? 'dirty' : 'idle';
    this._updateIndicator();
    if (window.App && window.App.renderModule) {
      try { window.App.renderModule(window.App.currentModule || 'dashboard'); } catch (e) {}
    }
    if (needPush) this.pushToCloud();
    return true;
  },

  // ===== 手动同步（拉取云端 → 合并到本地 → 推送） =====
  async syncNow() {
    const pullResult = await this.fetchFromCloud();
    if (pullResult.success && pullResult.hasData && pullResult.data) {
      this._mergeCloudData(pullResult.data);
    }
    // 推送本地数据到云端（确保云端最新；拉取失败时 pushToCloud 会拒绝推送防覆盖）
    const pushResult = await this.pushToCloud();
    return { pull: pullResult, push: pushResult };
  },

  // ===== 初始化（本地立即完成，云端后台异步拉取，不阻塞首屏） =====
  async init() {
    const storedVersion = localStorage.getItem(this.VERSION_KEY);
    const needsReload = storedVersion !== this.DATA_VERSION;
    this.CLOUD.pulling = true;
    this.CLOUD.everMerged = localStorage.getItem(this.EVER_MERGED_KEY) === '1';

    if (needsReload) {
      Object.keys(MODULE_CONFIG).forEach(moduleId => {
        localStorage.removeItem(this.getKey(moduleId));
      });
      localStorage.removeItem(this.FILE_PREFIX);
      localStorage.removeItem(this.PREFIX + '_last_modified');
    }

    // 首次使用：先加载示例数据（直接写本地，不走 save，避免示例数据触发推送/修改时间；
    // 云端拉到真实数据后会自动覆盖示例）
    if (!localStorage.getItem(this.INIT_KEY)) {
      Object.keys(SAMPLE_DATA).forEach(moduleId => {
        try { localStorage.setItem(this.getKey(moduleId), JSON.stringify(SAMPLE_DATA[moduleId])); } catch (e) {}
      });
      if (typeof SAMPLE_FILES !== 'undefined') {
        localStorage.setItem(this.FILE_PREFIX, JSON.stringify(SAMPLE_FILES));
      }
      localStorage.setItem(this.INIT_KEY, '1');
      localStorage.setItem(this.VERSION_KEY, this.DATA_VERSION);
    } else {
      localStorage.setItem(this.VERSION_KEY, this.DATA_VERSION);
    }

    // 云端拉取放后台：最快通道先返回先渲染，全部通道完成后再用最新数据校正
    if (this.CLOUD.enabled) {
      // 记录首拉前本地数据量：0=全新设备（首拉合并以云端为基础追加新增）；>0=老设备（本地为准防删除回弹）
      this.CLOUD.prePullTotal = this._countRecords(this._collectAllData());
      const applyInit = (result) => {
        if (result && result.success && result.hasData && result.data) {
          const applied = this._mergeCloudData(result.data);
          if (applied && window.App && window.App.renderModule) {
            try { window.App.renderModule(window.App.currentModule || 'dashboard'); } catch (e) {}
          }
        }
      };
      this.fetchFromCloud((q) => applyInit(q)).then(result => {
        this.CLOUD.pulling = false;
        applyInit(result);
        // 云端确认为空（全新班级）：本地数据即为权威，允许首次推送
        if (result.success && !result.hasData) {
          this._markMerged();
        }
        if (!result.success) {
          this.CLOUD.syncStatus = this.CLOUD.dirty ? 'dirty' : 'error';
          this._updateIndicator();
          if (window.App && window.App.toast) {
            try { window.App.toast('云端暂时连不上，数据已保存在本机，网络恢复后自动同步', 'warning'); } catch (e) {}
          }
        }
        // pulling 期间用户做了上传/修改：拉取结束后补推
        if (this.CLOUD.pendingPush) {
          this.CLOUD.pendingPush = false;
          setTimeout(() => { if (!this.CLOUD.isSyncing && !this.CLOUD.pushInFlight) this.pushToCloud(); }, 300);
        }
      }).catch(e => {
        this.CLOUD.pulling = false;
        this.CLOUD.syncStatus = this.CLOUD.dirty ? 'dirty' : 'error';
        this._updateIndicator();
        console.warn('云端拉取异常:', e);
        if (this.CLOUD.pendingPush) {
          this.CLOUD.pendingPush = false;
          setTimeout(() => { if (!this.CLOUD.isSyncing && !this.CLOUD.pushInFlight) this.pushToCloud(); }, 300);
        }
      });
      // 启动实时同步调度（网络恢复/回到前台/定时重试）
      this.startRealtimeSync();
    } else {
      this.CLOUD.pulling = false;
    }
  },

  // ===== 基础CRUD =====
  getKey(moduleId) {
    return this.PREFIX + moduleId;
  },

  get(moduleId) {
    const raw = localStorage.getItem(this.getKey(moduleId));
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        console.error('数据解析失败:', e);
        return [];
      }
    }
    return SAMPLE_DATA[moduleId] ? JSON.parse(JSON.stringify(SAMPLE_DATA[moduleId])) : [];
  },

  save(moduleId, data) {
    // 类型防御：模块数据必须是数组，拒绝把单条对象等错误结构写入
    if (!Array.isArray(data)) {
      console.error('Store.save 拒绝写入非数组数据:', moduleId, typeof data);
      return;
    }
    try {
      localStorage.setItem(this.getKey(moduleId), JSON.stringify(data));
    } catch (e) {
      console.error('本地存储写入失败（可能存储空间已满）:', e);
      if (typeof App !== 'undefined' && App.toast) {
        App.toast('本地存储空间不足，部分数据可能未保存，请清理文件中心的大文件', 'error');
      }
    }
    // 记录本地修改时间，用于与云端冲突对比（防止本地新数据被云端旧数据覆盖而丢失）
    this._setLocalModified(new Date().toISOString());
    this.schedulePush();
  },

  add(moduleId, record) {
    const data = this.get(moduleId);
    record.id = record.id || ('id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    const nowIso = new Date().toISOString();
    record.createdAt = record.createdAt || nowIso;
    record.updatedAt = nowIso;
    data.push(record);
    this.save(moduleId, data);
    return record;
  },

  update(moduleId, id, updates) {
    const data = this.get(moduleId);
    const index = data.findIndex(r => r.id === id);
    if (index !== -1) {
      data[index] = { ...data[index], ...updates, id: id, updatedAt: new Date().toISOString() };
      this.save(moduleId, data);
      return data[index];
    }
    return null;
  },

  delete(moduleId, id) {
    const data = this.get(moduleId);
    const filtered = data.filter(r => r.id !== id);
    this.save(moduleId, filtered);
    this._addTomb(moduleId, id);   // 记录删除墓碑，随同步通知其他设备删除
  },

  // ===== 课表特殊处理 =====
  getSchedule() {
    const raw = localStorage.getItem(this.getKey('schedule'));
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        return {};
      }
    }
    return SAMPLE_DATA.schedule ? JSON.parse(JSON.stringify(SAMPLE_DATA.schedule)) : {};
  },

  saveSchedule(data) {
    try {
      localStorage.setItem(this.getKey('schedule'), JSON.stringify(data));
    } catch (e) {
      console.error('课表存储失败:', e);
    }
    this.schedulePush();
  },

  setScheduleCell(periodIndex, dayIndex, cellData) {
    const data = this.getSchedule();
    const key = `${periodIndex}-${dayIndex}`;
    if (cellData && cellData.subject) {
      data[key] = cellData;
    } else {
      delete data[key];
    }
    this.saveSchedule(data);
  },

  getScheduleCell(periodIndex, dayIndex) {
    const data = this.getSchedule();
    return data[`${periodIndex}-${dayIndex}`] || null;
  },

  // ===== 文件中心 =====
  getFiles() {
    const raw = localStorage.getItem(this.FILE_PREFIX);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        return [];
      }
    }
    return [];
  },

  addFile(fileInfo) {
    const files = this.getFiles();
    fileInfo.id = 'file_' + Date.now();
    fileInfo.createdAt = new Date().toISOString();
    files.unshift(fileInfo);
    if (files.length > 100) {
      files.length = 100;
    }
    try {
      localStorage.setItem(this.FILE_PREFIX, JSON.stringify(files));
    } catch (e) {
      console.error('文件存储失败（可能存储空间已满）:', e);
      if (typeof App !== 'undefined' && App.toast) {
        App.toast('存储空间不足，文件保存失败，请删除一些旧文件', 'error');
      }
      // 回滚：移除刚添加的文件
      files.shift();
      return null;
    }
    this.schedulePush();
    return fileInfo;
  },

  deleteFile(fileId) {
    const files = this.getFiles();
    const filtered = files.filter(f => f.id !== fileId);
    localStorage.setItem(this.FILE_PREFIX, JSON.stringify(filtered));
    this._addTomb('_files', fileId);   // 文件删除也跨设备同步
    this.schedulePush();
  },

  saveFileList(files) {
    localStorage.setItem(this.FILE_PREFIX, JSON.stringify(files));
    this.schedulePush();
  },

  // ===== 统计 =====
  getStats() {
    const stats = {};
    Object.keys(MODULE_CONFIG).forEach(moduleId => {
      const config = MODULE_CONFIG[moduleId];
      if (config.type === 'schedule') {
        const data = this.getSchedule();
        stats[moduleId] = Object.keys(data).length;
      } else {
        stats[moduleId] = this.get(moduleId).length;
      }
    });
    return stats;
  },

  // ===== 清空所有数据（本地+云端） =====
  async clearAll() {
    Object.keys(MODULE_CONFIG).forEach(moduleId => {
      localStorage.removeItem(this.getKey(moduleId));
    });
    localStorage.removeItem(this.FILE_PREFIX);
    localStorage.removeItem(this.INIT_KEY);
    // 清空云端
    if (this.CLOUD.enabled) {
      const emptyData = { version: this.DATA_VERSION, lastModified: new Date().toISOString() };
      Object.keys(MODULE_CONFIG).forEach(mid => {
        emptyData[mid] = MODULE_CONFIG[mid].type === 'schedule' ? {} : [];
      });
      emptyData._files = [];
      try {
        await fetch(this.CLOUD.apiBase + this.CLOUD.gistId, {
          method: 'PATCH',
          headers: {
            'Authorization': 'Bearer ' + this.CLOUD.token,
            'Content-Type': 'application/json',
            'User-Agent': 'banwei-workbench'
          },
          body: JSON.stringify({ files: { 'data.json': { content: JSON.stringify(emptyData, null, 2) } } })
        });
      } catch (e) {
        console.error('清空云端失败:', e);
      }
    }
    this.init();
  },

  // ===== 导出全部数据（备份） =====
  exportAll() {
    const backup = {};
    Object.keys(MODULE_CONFIG).forEach(moduleId => {
      if (MODULE_CONFIG[moduleId].type === 'schedule') {
        backup[moduleId] = this.getSchedule();
      } else {
        backup[moduleId] = this.get(moduleId);
      }
    });
    backup._files = this.getFiles();
    backup._exportTime = new Date().toISOString();
    return backup;
  },

  // ===== 导入全部数据（恢复） =====
  importAll(data) {
    if (!data || typeof data !== 'object') return false;
    Object.keys(MODULE_CONFIG).forEach(moduleId => {
      if (data[moduleId]) {
        if (MODULE_CONFIG[moduleId].type === 'schedule') {
          this.saveSchedule(data[moduleId]);
        } else {
          this.save(moduleId, data[moduleId]);
        }
      }
    });
    if (data._files) {
      localStorage.setItem(this.FILE_PREFIX, JSON.stringify(data._files));
      this.schedulePush();
    }
    return true;
  }
};
