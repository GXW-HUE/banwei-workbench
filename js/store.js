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
    debounceMs: 3000,      // 修改后防抖推送间隔
    lastPushTime: 0,
    pushTimer: null,
    isSyncing: false,
    lastSyncTime: null,
    syncStatus: 'idle',    // idle | pulling | pushing | dirty | error
    dirty: false,          // 本机有改动尚未成功推送
    pendingPush: false,    // pulling 期间收到的推送请求，pulling 结束后补推
    realtimeStarted: false
  },

  DIRTY_KEY: 'class_workbench__cloud_dirty',

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

  // ===== 云同步：多通道拉取，收集全部成功结果取 lastModified 最新的（防止代理缓存旧数据） =====
  async fetchFromCloud() {
    if (!this.CLOUD.enabled) return { success: false, reason: 'disabled' };
    this.CLOUD.syncStatus = 'pulling';
    this._updateIndicator();
    const channels = this._buildChannels();
    const controllers = channels.map(() => new AbortController());
    const tasks = channels.map((ch, i) => new Promise((resolve, reject) => {
      const start = () => {
        if (controllers[i].signal.aborted) { reject(new Error('skipped')); return; }
        this._fetchOneChannel(ch, 15000, controllers[i]).then(r => {
          if (r.success && r.hasData) resolve(r); else reject(new Error('empty'));
        }, reject);
      };
      // API 通道延迟 1.5s 发起：代理/raw 通常更快，省 API 限流；但仍会参与最终取最新
      if (ch.api) setTimeout(start, 1500); else start();
    }));
    try {
      const settled = await Promise.allSettled(tasks);
      controllers.forEach(c => { try { c.abort(); } catch (e) {} });
      const successes = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
      if (successes.length === 0) {
        const errs = settled.filter(r => r.status === 'rejected').map(r => String(r.reason).slice(0, 40));
        throw new Error('all channels failed: ' + errs.join(' | '));
      }
      // 取 lastModified 最新的结果（防止某个代理返回缓存的旧数据）
      successes.sort((a, b) => {
        const am = a.data && a.data.lastModified ? new Date(a.data.lastModified).getTime() : 0;
        const bm = b.data && b.data.lastModified ? new Date(b.data.lastModified).getTime() : 0;
        return bm - am;
      });
      const best = successes[0];
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
    if (this.CLOUD.isSyncing) return { success: false, reason: 'busy' };
    this._setDirty();
    // 冲突检测：推送前先看云端是否被其他设备更新过（多通道拉取，弱网也能成功）
    // 原则：记录数多的为准；数量相同比修改时间；云端拉取失败则拒绝推送防覆盖（稍后自动重试）
    if (!this.CLOUD.pulling) {
      let cloud = null;
      try {
        cloud = await this.fetchFromCloud();
      } catch (e) {}
      if (cloud && cloud.success && cloud.data) {
        const cloudModified = cloud.data.lastModified ? new Date(cloud.data.lastModified).getTime() : 0;
        const localModified = this._getLocalModified();
        const cloudTotal = this._countRecords(cloud.data);
        const localTotal = this._countRecords(this._collectAllData());
        const shouldPull = (cloudModified > 0 && localModified === 0) ||
                           (cloudTotal > localTotal) ||
                           // 本地有未上传修改时，记录数相同绝不被云端覆盖（防止丢失用户刚上传的数据）
                           (!this.CLOUD.dirty && cloudTotal === localTotal && cloudModified > localModified);
        if (shouldPull) {
          this._applyCloudData(cloud.data);
          this._setLocalModified(cloud.data.lastModified);
        }
        // 否则保留本地（本地更新/记录更多），推送时自然带上本地数据
      } else if (cloud && cloud.success && cloud.hasData === false) {
        // 云端还没有数据：允许推送（首次建立）
      } else {
        // 云端拉取失败：拒绝推送，避免本地数据覆盖云端；保持 dirty，网络恢复后自动重试
        console.warn('云端拉取失败，取消推送（防止覆盖云端数据），将自动重试');
        this.CLOUD.syncStatus = 'dirty';
        this._updateIndicator();
        this.startRealtimeSync();
        return { success: false, reason: 'pull_failed' };
      }
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
      // 弱网重试 3 次（间隔 2s / 4s / 8s）
      let ok = false, lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await this._pushOnce(body);
          ok = true;
          break;
        } catch (e) {
          lastErr = e;
          console.warn('云端推送第 ' + (attempt + 1) + ' 次失败:', e);
          if (attempt < 2) await this._sleep(2000 * Math.pow(2, attempt));
        }
      }
      if (ok) {
        this.CLOUD.lastPushTime = Date.now();
        this.CLOUD.lastSyncTime = new Date().toISOString();
        this.CLOUD.syncStatus = 'idle';
        this.CLOUD.isSyncing = false;
        this._clearDirty();
        return { success: true };
      }
      throw lastErr || new Error('push failed');
    } catch (e) {
      console.error('云端推送失败（数据已保存在本机，联网后自动重试）:', e);
      this.CLOUD.syncStatus = 'dirty';
      this.CLOUD.isSyncing = false;
      this._updateIndicator();
      this.startRealtimeSync();
      return { success: false, error: String(e) };
    }
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
    // 上次退出前有未完成的推送：启动后补推
    try {
      if (localStorage.getItem(this.DIRTY_KEY)) {
        this.CLOUD.dirty = true;
        setTimeout(() => { if (!this.CLOUD.isSyncing) this.syncNow(); }, 3000);
      }
    } catch (e) {}
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
    // 定时：有待推送数据每 45s 重试；每 5 分钟自动拉取一次新数据
    setInterval(() => {
      if (this.CLOUD.dirty && !this.CLOUD.isSyncing && !document.hidden) this.syncNow();
    }, 45000);
    setInterval(() => {
      if (!document.hidden && !this.CLOUD.isSyncing) this._foregroundSync();
    }, 300000);
  },

  async _foregroundSync() {
    if (this.CLOUD.isSyncing || this.CLOUD.pulling) return;
    const result = await this.fetchFromCloud();
    if (result.success && result.hasData && result.data) {
      const merged = this._mergeCloudData(result.data);
      if (merged) {
        if (window.App && window.App.renderModule) {
          try { window.App.renderModule(window.App.currentModule || 'dashboard'); } catch (e) {}
        }
      }
    }
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
        data[moduleId] = this.get(moduleId);
      }
    });
    data._files = this.getFiles();
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
        } else {
          localStorage.setItem(this.getKey(moduleId), JSON.stringify(cloudData[moduleId]));
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
    // 记录云端最后修改时间，供冲突检测使用
    if (cloudData.lastModified) {
      this._setLocalModified(cloudData.lastModified);
    }
  },

  // ===== 云端数据合并决策：返回 true 表示采用了云端数据 =====
  _mergeCloudData(cloudData) {
    if (!cloudData || typeof cloudData !== 'object') return false;
    const cloudModified = cloudData.lastModified ? new Date(cloudData.lastModified).getTime() : 0;
    const localModified = this._getLocalModified();
    const cloudTotal = this._countRecords(cloudData);
    const localTotal = this._countRecords(this._collectAllData());
    if (cloudModified > 0 && (localModified === 0 || (cloudModified >= localModified && cloudTotal >= localTotal))) {
      this._applyCloudData(cloudData);
      this.CLOUD.syncStatus = this.CLOUD.dirty ? 'dirty' : 'idle';
      return true;
    }
    if (cloudTotal > localTotal) {
      this._applyCloudData(cloudData);
      this.CLOUD.syncStatus = this.CLOUD.dirty ? 'dirty' : 'idle';
      return true;
    }
    if (cloudModified === 0 && cloudTotal === 0) {
      this.CLOUD.syncStatus = this.CLOUD.dirty ? 'dirty' : 'idle';
      this.pushToCloud();
      return false;
    }
    // 本地更新/更多：保留本地，补推
    this.CLOUD.syncStatus = this.CLOUD.dirty ? 'dirty' : 'idle';
    this.pushToCloud();
    return false;
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

    // 云端拉取放后台：页面先渲染，数据到位后自动刷新；失败不阻塞、不覆盖
    if (this.CLOUD.enabled) {
      this.fetchFromCloud().then(result => {
        this.CLOUD.pulling = false;
        if (result.success && result.hasData && result.data) {
          const applied = this._mergeCloudData(result.data);
          // 数据到位后刷新当前页面
          if (applied && window.App && window.App.renderModule) {
            try { window.App.renderModule(window.App.currentModule || 'dashboard'); } catch (e) {}
          }
        } else if (!result.success) {
          this.CLOUD.syncStatus = this.CLOUD.dirty ? 'dirty' : 'error';
          this._updateIndicator();
          if (window.App && window.App.toast) {
            try { window.App.toast('云端暂时连不上，数据已保存在本机，网络恢复后自动同步', 'warning'); } catch (e) {}
          }
        }
        // pulling 期间用户做了上传/修改：拉取结束后补推
        if (this.CLOUD.pendingPush) {
          this.CLOUD.pendingPush = false;
          setTimeout(() => { if (!this.CLOUD.isSyncing) this.pushToCloud(); }, 800);
        }
      }).catch(e => {
        this.CLOUD.pulling = false;
        this.CLOUD.syncStatus = this.CLOUD.dirty ? 'dirty' : 'error';
        this._updateIndicator();
        console.warn('云端拉取异常:', e);
        if (this.CLOUD.pendingPush) {
          this.CLOUD.pendingPush = false;
          setTimeout(() => { if (!this.CLOUD.isSyncing) this.pushToCloud(); }, 800);
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
    data.push(record);
    this.save(moduleId, data);
    return record;
  },

  update(moduleId, id, updates) {
    const data = this.get(moduleId);
    const index = data.findIndex(r => r.id === id);
    if (index !== -1) {
      data[index] = { ...data[index], ...updates, id: id };
      this.save(moduleId, data);
      return data[index];
    }
    return null;
  },

  delete(moduleId, id) {
    const data = this.get(moduleId);
    const filtered = data.filter(r => r.id !== id);
    this.save(moduleId, filtered);
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
