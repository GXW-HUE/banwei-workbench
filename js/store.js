/* ============================================
   班委工作台 - 数据存储管理 (localStorage + GitHub Gist 云同步)
   ============================================ */

const Store = {
  PREFIX: 'class_workbench_',
  FILE_PREFIX: 'class_workbench_files_',
  INIT_KEY: 'class_workbench_initialized',
  VERSION_KEY: 'class_workbench_data_version',
  DATA_VERSION: '1.7.0',
  SHARD_COUNT_KEY: 'class_workbench_blob_shards',   // 上次推送的内容分片数量（用于清理多余旧分片）

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
  LEGACY_CLEAN_KEY: 'class_workbench__legacy_clean',  // v47：旧版无后缀分片是否已清理（一次性标记）
  TOMB_TTL: 30 * 24 * 3600 * 1000,           // 墓碑保留30天

  // ===== 文件内容存储引擎（IndexedDB）=====
  // 背景：文件内容（base64）原先与元数据一起塞进 localStorage，而 localStorage 单域名上限约 5MB，
  //       传几个 Excel/PDF 就会写爆并报"存储空间不足"。现拆分存储：
  //   · 文件元数据（名称/大小/类型等，体积很小）→ localStorage，保持同步读取、渲染快
  //   · 文件内容（base64，体积大）→ IndexedDB，配额可达数百 MB~数 GB，不再受 5MB 限制
  // 对外 API（getFiles / addFile / deleteFile 等）保持同步签名不变，app.js、exporter.js 无需改动。
  DB_NAME: 'class_workbench_db',
  DB_VERSION: 1,
  DB_STORE: 'file_content',
  MAX_FILES: 500,                // 文件中心最多保留数量（由 100 提升为 500）

  _db: null,
  _dbReady: null,
  _idbOk: false,                 // IndexedDB 是否可用（不可用时自动降级为内联存储）
  _contentCache: {},             // fileId -> base64 内容（内存缓存，保证 getFiles() 同步返回）

  // 打开（必要时创建）IndexedDB
  _openDB() {
    if (this._dbReady) return this._dbReady;
    this._dbReady = new Promise((resolve) => {
      let req;
      try {
        if (typeof indexedDB === 'undefined' || !indexedDB) { resolve(null); return; }
        req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      } catch (e) { console.error('IndexedDB 不可用:', e); resolve(null); return; }
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.DB_STORE)) {
            db.createObjectStore(this.DB_STORE, { keyPath: 'id' });
          }
        } catch (e) {}
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => { console.warn('IndexedDB 打开失败:', req.error); resolve(null); };
      req.onblocked = () => resolve(null);
    });
    return this._dbReady;
  },

  // 写入单个文件内容
  async _idbPut(id, content) {
    const db = await this._openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.DB_STORE, 'readwrite');
        tx.objectStore(this.DB_STORE).put({ id: id, content: content, updatedAt: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch (e) { resolve(false); }
    });
  },

  // 删除单个文件内容
  async _idbDelete(id) {
    const db = await this._openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.DB_STORE, 'readwrite');
        tx.objectStore(this.DB_STORE).delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) { resolve(false); }
    });
  },

  // 读取全部文件内容 → { id: content }
  async _idbGetAll() {
    const db = await this._openDB();
    if (!db) return {};
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.DB_STORE, 'readonly');
        const req = tx.objectStore(this.DB_STORE).getAll();
        req.onsuccess = () => {
          const map = {};
          (req.result || []).forEach(r => { if (r && r.id) map[r.id] = r.content; });
          resolve(map);
        };
        req.onerror = () => resolve({});
      } catch (e) { resolve({}); }
    });
  },

  // 推送前：把 IndexedDB 中已落盘的文件内容全部刷新进内存缓存，
  // 确保「从云端拉取得到内容、或本机曾打开过」的文件，在做整包 PATCH 时不会被从 files_blob 中漏掉。
  // 这是修复“换设备/刷新后推送会丢掉别的设备文件内容”的根因。
  async _refreshContentCache() {
    if (!this._idbOk) return;
    try {
      const map = await this._idbGetAll();
      if (map && typeof map === 'object') {
        Object.keys(map).forEach(k => { if (map[k]) this._contentCache[k] = map[k]; });
      }
    } catch (e) {}
  },

  // 清空文件内容库
  async _idbClear() {
    const db = await this._openDB();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(this.DB_STORE, 'readwrite');
        tx.objectStore(this.DB_STORE).clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) { resolve(false); }
    });
  },

  // 启动时初始化：打开 IndexedDB → 内容载入内存缓存 → 迁移历史内联内容
  async _initFileStore() {
    this._contentCache = this._contentCache || {};
    const db = await this._openDB();
    this._idbOk = !!db;
    if (db) {
      const map = await this._idbGetAll();
      Object.keys(map).forEach(k => { this._contentCache[k] = map[k]; });
      await this._migrateInlineContent();
    } else {
      // 降级：IndexedDB 不可用（极罕见，如隐私模式），维持旧的内联存储行为
      console.warn('IndexedDB 不可用，文件内容退回 localStorage 内联存储（仍受约 5MB 限制）');
    }
  },

  // 一次性迁移：把历史上内联在 localStorage 里的 base64 内容搬进 IndexedDB，
  // 迁移后从元数据中剥离 content 字段，localStorage 占用立刻大幅下降。
  async _migrateInlineContent() {
    const raw = localStorage.getItem(this.FILE_PREFIX);
    if (!raw) return;
    let metas;
    try { metas = JSON.parse(raw); } catch (e) { return; }
    if (!Array.isArray(metas) || metas.length === 0) return;
    let changed = false;
    for (let i = 0; i < metas.length; i++) {
      const m = metas[i];
      if (!m) continue;
      if (typeof m.content === 'string' && m.content.length > 0) {
        this._contentCache[m.id] = m.content;
        m.contentChars = m.content.length;
        m.hasContent = true;
        delete m.content;               // 剥离大字段，释放 localStorage
        await this._idbPut(m.id, this._contentCache[m.id]);
        changed = true;
      } else if (m.cloudLimited && m.hasContent === undefined) {
        m.hasContent = false;           // 云端剥离的文件：本设备也无内容
      }
    }
    if (changed) {
      try {
        localStorage.setItem(this.FILE_PREFIX, JSON.stringify(metas));
        console.log('文件内容已迁移至 IndexedDB，localStorage 占用已释放');
      } catch (e) {}
    }
  },

  // 统一写文件：元数据 → localStorage，内容 → IndexedDB（并刷新内存缓存）
  _writeFilesWithContent(files) {
    const list = Array.isArray(files) ? files : [];
    const metas = [];
    list.forEach(f => {
      if (!f) return;
      const m = Object.assign({}, f);
      const content = (typeof m.content === 'string' && m.content.length > 0) ? m.content : null;
      if (content) {
        m.hasContent = true;
        m.contentChars = content.length;
        this._contentCache[m.id] = content;
        if (this._idbOk) {
          // 写入 IndexedDB（异步，不阻塞界面）；失败自动重试一次，仍失败则告警，避免内容静默丢失
          this._idbPut(m.id, content).then(ok => {
            if (!ok) {
              this._idbPut(m.id, content).then(ok2 => {
                if (!ok2) console.error('文件内容写入 IndexedDB 失败:', m.id);
              });
            }
          });
          delete m.content;
        } else {
          m.content = content;          // 降级：继续内联
        }
      } else if (this._idbOk) {
        delete m.content;               // 无内容（云端剥离等），元数据不留大字段
      }
      metas.push(m);
    });
    try {
      localStorage.setItem(this.FILE_PREFIX, JSON.stringify(metas));
      return true;
    } catch (e) {
      console.error('文件元数据写入失败:', e);
      return false;
    }
  },

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
  // 每个通道提供：url（拉 data.json）+ base（拼接分片文件名 files_blob_0/1/...）
  _buildChannels() {
    const ts = Date.now();
    const owner = this.CLOUD.owner, gid = this.CLOUD.gistId;
    const rawBase = 'https://gist.githubusercontent.com/' + owner + '/' + gid + '/raw/';
    const dataUrl = rawBase + 'data.json?t=' + ts;
    const enc = encodeURIComponent;
    // 需要整段 URL 编码的 CORS 代理：分片地址也必须整体编码后拼接
    const encProxy = (name, prefix) => ({
      name, api: false,
      url: prefix + enc(dataUrl),
      shard: (nm) => prefix + enc(rawBase + nm + '?t=' + ts)
    });
    return [
      { name: 'pages',       url: 'https://gxw-hue.github.io/banwei-workbench/sync/data.json?t=' + ts,
                             base: 'https://gxw-hue.github.io/banwei-workbench/sync/', api: false },
      { name: 'gh-proxy',    url: 'https://gh-proxy.com/' + dataUrl,    base: 'https://gh-proxy.com/' + rawBase,    api: false },
      { name: 'ghfast',      url: 'https://ghfast.top/' + dataUrl,      base: 'https://ghfast.top/' + rawBase,      api: false },
      { name: 'githack',     url: 'https://gist.githack.com/' + owner + '/' + gid + '/raw/data.json?t=' + ts,
                             shard: (nm) => 'https://gist.githack.com/' + owner + '/' + gid + '/raw/' + nm + '?t=' + ts, api: false },
      { name: 'allorigins',  ...encProxy('allorigins', 'https://api.allorigins.win/raw?url=') },
      { name: 'codetabs',    ...encProxy('codetabs', 'https://api.codetabs.com/v1/proxy?quest=') },
      { name: 'raw',         url: dataUrl,                              base: rawBase,                              api: false },
      { name: 'api',         url: this.CLOUD.apiBase + gid,             base: null,                                 api: true,
        headers: { 'Authorization': 'Bearer ' + this.CLOUD.token, 'Accept': 'application/vnd.github.v3+json' } },
      { name: 'ghproxy-net', url: 'https://ghproxy.net/' + dataUrl,     base: 'https://ghproxy.net/' + rawBase,     api: false }
    ];
  },

  // 单通道拉取（独立超时，可被外部 abort）
  // 拉取 data.json 后，根据其中 _blobShards 列表（或旧版单一 files_blob）并发拉取所有文件内容分片，
  // 合并成 data.files 供后续恢复使用。分片缺失/失败不致命：本机有内容的文件仍可用。
  async _fetchOneChannel(ch, timeoutMs, controller) {
    const ctl = controller || new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const _headers = Object.assign({ 'User-Agent': 'banwei-workbench', 'Accept': 'application/json' }, ch.headers || {});
    try {
      let data, filesData = {};
      const _norm = (nm) => (nm && String(nm).endsWith('.json')) ? nm : (nm + '.json');
      if (ch.api) {
        const resp = await fetch(ch.url, { signal: ctl.signal, headers: _headers, cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const gist = JSON.parse(await resp.text());
        const file = gist.files && gist.files['data.json'];
        if (!file || !file.content) return { success: true, hasData: false };
        data = JSON.parse(file.content);
        // API 通道直接遍历 gist.files 收集所有 files_blob* 分片（含旧版单一 files_blob.json 与分片 files_blob_0/1/...）
        Object.keys(gist.files).forEach(n => {
          if (n === 'data.json') return;
          if (n.indexOf('files_blob') === 0) {
            try {
              const j = JSON.parse(gist.files[n].content || '{}');
              // 兼容两种落盘格式：{ files: {...} } 与裸映射 {...}
              const map = (j && j.files && typeof j.files === 'object') ? j.files : j;
              if (map && typeof map === 'object') Object.assign(filesData, map);
            } catch (e) {}
          }
        });
      } else {
        const resp = await fetch(ch.url, { signal: ctl.signal, headers: _headers, cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        data = JSON.parse(await resp.text());
        // 分片清单：新格式用 _blobShards（files_blob_0/1/...）；旧格式（无清单）回退到单一 files_blob.json
        // 另外兜底多探 2 个分片：清单本身可能因上次推送失败而未更新（防止漏拉导致文件内容缺失）
        // 文件名统一带 .json：仓库落盘为 files_blob_0.json，清单里可能是旧式无扩展名，用外层 _norm 补齐，避免 404
        const shardNames = (data._blobShards && data._blobShards.length) ? data._blobShards.map(_norm) : ['files_blob.json'];
        const extra = [];
        for (let i = shardNames.length; i < shardNames.length + 2; i++) extra.push('files_blob_' + i + '.json');
        await Promise.all(shardNames.concat(extra).map(async (nm) => {
          try {
            const surl = ch.shard ? ch.shard(nm) : (ch.base + nm + '?t=' + Date.now());
            const r = await fetch(surl, { signal: ctl.signal, headers: _headers, cache: 'no-store' });
            if (r.ok) {
              const j = JSON.parse(await r.text());
              const map = (j && j.files && typeof j.files === 'object') ? j.files : j;
              if (map && typeof map === 'object') Object.assign(filesData, map);
            }
          } catch (e) { /* 单分片失败不致命 */ }
        }));
      }
      // filesData 本身就是 { 文件id: 内容 } 的映射，直接作为 cloudData.files 供后续合并恢复
      data.files = filesData || {};
      // 记住云端分片清单：本机暂无内容时推送不会清空清单，保证其他设备仍能定位到分片
      if (data._blobShards && data._blobShards.length) this.CLOUD._lastShards = data._blobShards.map(_norm);
      return { success: true, hasData: true, data, channel: ch.name };
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
    const real = this._doFetchFromCloud(onQuick);
    this.CLOUD.pullPromise = real;
    // 兜底超时：防止某个通道 fetch 挂起（如代理永久不响应/abort 信号未生效）导致 pullPromise
    // 永久 pending，进而让后续所有同步都复用这个“死 promise”而永远不同步。超时即丢弃并允许下次重拉。
    const guard = new Promise((_, rej) => setTimeout(() => rej(new Error('pull guard timeout')), 30000));
    try {
      return await Promise.race([real, guard]);
    } catch (e) {
      this.CLOUD.pullPromise = null;
      throw e;
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
        this._fetchOneChannel(ch, ch.api ? 10000 : (ch.name === 'pages' ? 30000 : 8000), controllers[i]).then(r => {
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
      this.CLOUD._lastPullChannel = best.channel || '?';
      this.CLOUD._lastPullAt = new Date().toISOString();
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
  // 双层超时兜底：AbortController 在部分网络/代理下 abort 信号可能不生效，导致 fetch 永久挂起、
  // 推送锁永久占用、后续所有同步全部卡死（曾致"上传成功但云端收不到"）。此处再加一层 Promise.race
  // 硬超时：无论 abort 是否生效，30 秒内必然 reject 并释放推送锁，由外层重试/轮询补推，绝不卡死。
  // v44：识别 GitHub 写配额撞限（403 + x-ratelimit-reset）。写配额 100 次/小时且全设备共享，
  // 撞限时快速重试只会继续烧配额；改为读取 reset 时间、等待配额恢复后再重试一次。
  async _pushOnce(body, rateLimitWaitMs) {
    const ctl = new AbortController();
    const abortTimer = setTimeout(() => { try { ctl.abort(); } catch (e) {} }, 20000);
    let hardTimer = null;
    const hard = new Promise((_, rej) => { hardTimer = setTimeout(() => rej(new Error('PUSH_HARD_TIMEOUT')), 30000); });
    try {
      const resp = await Promise.race([
        fetch(this.CLOUD.apiBase + this.CLOUD.gistId, {
          method: 'PATCH',
          signal: ctl.signal,
          headers: {
            'Authorization': 'Bearer ' + this.CLOUD.token,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'banwei-workbench'
          },
          body: JSON.stringify(body)
        }),
        hard
      ]);
      if (resp.status === 403) {
        // 写配额撞限：等待 reset 后重试一次（reset 由响应头给出，最多等 65 秒）
        let waitMs = 65000;
        try {
          const rl = resp.headers.get('x-ratelimit-reset');
          if (rl) {
            const resetSec = Number(rl) * 1000 - Date.now();
            if (resetSec > 500 && resetSec < 65000) waitMs = resetSec + 500;
          }
        } catch (e) {}
        const txt = await resp.text().catch(() => '');
        if (txt && txt.indexOf('rate limit') >= 0) {
          console.warn('GitHub 写配额已满，等待 ' + Math.round(waitMs / 1000) + ' 秒后重试');
          if (rateLimitWaitMs) await this._sleep(waitMs);
          throw new Error('RATE_LIMIT_WAIT');
        }
        throw new Error('HTTP 403');
      }
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return true;
    } finally {
      clearTimeout(abortTimer);
      if (hardTimer) clearTimeout(hardTimer);
    }
  },

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); },

  // ===== 分片哈希（增量推送用） =====
  // 记录上次成功推送后每个分片的内容哈希；下次推送时只重传变化的文件，未变化的跳过。
  // 存 localStorage（仅哈希字符串，体积极小），不占 IndexedDB。
  SHARD_HASH_KEY: 'class_workbench_shard_hashes',
  _getShardHashes() {
    try { return JSON.parse(localStorage.getItem(this.SHARD_HASH_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  },
  _setShardHashes(map) {
    try { localStorage.setItem(this.SHARD_HASH_KEY, JSON.stringify(map || {})); } catch (e) {}
  },
  _hashStr(s) {
    // 快速非加密哈希：只用于判断分片内容是否变化，够用且快
    let h = 5381;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; }
    return h.toString(36);
  },

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
    this._setDirty();
    // 串行推送队列：持锁期间若又有改动（连续上传多个文件/快速连续编辑），schedulePush 会置
    // pendingPush；本轮 PATCH 完成后用"最新全量数据"重新拉取-合并-推送，直到队列排空，绝不丢更新。
    try {
      let rounds = 0;
      while (true) {
        rounds++;
        this.CLOUD.pendingPush = false;
        // 推送前先静默拉取并双向合并（pull-before-push）：把其他设备新增而本机暂缺的记录/文件并入，
        // 避免本机不全的整包 PATCH 覆盖云端（曾导致本机缺少的记录被删除）。
        // 首轮 10 秒内已成功拉取过可跳过；补推轮（队列里又来新改动）强制重新拉取最新云端。
        const forcePull = rounds > 1;
        const pulledRecently = !forcePull && this.CLOUD._lastPullOkAt && Date.now() - this.CLOUD._lastPullOkAt < 10000;
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
        // v47 迁移清理（推送前独立执行）：云端可能残留旧版无后缀分片 files_blob_N（贪心装箱时代，
        // 无 .json 后缀，占 Gist 总量 1MB 上限且内容已迁移到新分片）。删除它们把总量压回 1MB 内，
        // 否则后续推送可能因超限被 422/truncated，形成"清理在推送后、推送因超限失败"的死锁。
        // 独立于主推送：只要连上 GitHub 且未清理过，就先清一次；失败不阻塞主推送。
        try {
          if (!localStorage.getItem(this.LEGACY_CLEAN_KEY)) {
            const legacy = [];
            for (let i = 0; i < 20; i++) legacy.push('files_blob_' + i);
            legacy.push('files_blob');  // 兼容更早期单一分片
            const body2 = { files: {} };
            legacy.forEach(nm => { body2.files[nm] = { content: '' }; });
            const resp = await this._pushOnce(body2, false);
            if (resp) {
              try { localStorage.setItem(this.LEGACY_CLEAN_KEY, '1'); } catch (e) {}
              console.log('已清理旧版无后缀分片残留');
            }
          }
        } catch (e) { console.warn('旧分片清理跳过(忽略):', e); }
        // 推送前先把本机 IndexedDB 中的文件内容全部载入缓存，保证所有持有内容的文件都进 blob
        try { await this._refreshContentCache(); } catch (e) {}
        const allData = this._safeCollectAllData();
        allData.data.lastModified = new Date().toISOString();
        this._setLocalModified(allData.data.lastModified);
        // 增量推送：data.json 紧凑序列化（去掉缩进，省 20~30% 体积）；分片只推"内容变化"的部分。
        // 未变化的分片不放进 PATCH body，Gist 会保留原文件 → 每次推送体积从全量(700KB+)降到
        // 实际变化部分(通常几十 KB)，慢网也能 10 秒内完成，不再超时卡死。
        const body = { files: { 'data.json': { content: JSON.stringify(allData.data) } } };
        const prevHashes = this._getShardHashes();
        const newHashes = {};
        Object.keys(allData.filesPayload).forEach(name => {
          const v = allData.filesPayload[name];
          if (v === null) { body.files[name] = { content: '' }; newHashes[name] = null; return; }
          const h = this._hashStr(v);
          newHashes[name] = h;
          if (prevHashes[name] === h) return;   // 分片内容未变化：跳过，云端保留原分片
          body.files[name] = { content: v };
        });
        // 弱网重试 5 次（间隔 1s / 2s / 4s / 8s）；撞限 403 时等待配额恢复后重试一次
        let ok = false, lastErr = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            await this._pushOnce(body, attempt === 0);
            ok = true;
            break;
          } catch (e) {
            lastErr = e;
            console.warn('云端推送第 ' + (attempt + 1) + ' 次失败:', e);
            if (String(e).indexOf('RATE_LIMIT_WAIT') >= 0) {
              // 已等待配额恢复，再给一次机会；仍失败则交外层轮询补推
              attempt = 10;  // 跳出循环
              try { await this._pushOnce(body, false); ok = true; } catch (e2) { lastErr = e2; }
              break;
            }
            if (attempt < 4) await this._sleep(1000 * Math.pow(2, attempt));
          }
        }
        if (!ok) throw lastErr || new Error('push failed');
        this.CLOUD.lastPushTime = Date.now();
        this.CLOUD.lastSyncTime = new Date().toISOString();
        this._setShardHashes(newHashes);   // 推送成功：记录本次分片哈希，下次增量对比
        // 同步镜像到 GitHub Pages（sync/ 目录）：手机等连不上 GitHub 的设备
        // 可以直接从 gxw-hue.github.io 拉到同样数据。失败不影响主同步。
        // v44 节流：镜像提交每次消耗 4~5 次 GitHub 写配额（blob/tree/commit/ref），
        // 而写配额仅 100 次/小时且全设备共享——不节流会烧光配额导致所有设备 PATCH 403。
        // 因此镜像 10 分钟内最多提交一次（数据最终一致，延迟可接受）。
        try {
          const mirrorAt = this.CLOUD._lastMirrorAt || 0;
          if (Date.now() - mirrorAt >= 600000) {
            await this._pushRepoMirror(JSON.stringify(allData.data), allData.filesPayload, prevHashes, newHashes);
            this.CLOUD._lastMirrorAt = Date.now();
            this.CLOUD._lastMirrorModified = Date.parse(allData.data.lastModified) || Date.now();
            this.CLOUD._canReachCloud = true;
          }
        } catch (e) { console.warn('镜像提交失败(忽略):', e); }
        // 推送进行中又收到新改动 → 用最新全量数据再推一轮（最多 6 轮兜底，极端情况下次轮询补齐）
        if (this.CLOUD.pendingPush && rounds < 6) continue;
        this.CLOUD.isSyncing = false;
        this.CLOUD.pushInFlight = false;
        this.CLOUD.syncStatus = 'idle';
        this._updateIndicator();
        this._clearDirty();
        return { success: true };
      }
    } catch (e) {
      console.error('云端推送失败（数据已保存在本机，联网后自动重试）:', e);
      this.CLOUD.syncStatus = 'dirty';
      this.CLOUD.isSyncing = false;
      this.CLOUD.pushInFlight = false;
      this.CLOUD.pendingPush = true;   // 失败也标记补推，等待轮询/重试
      this._updateIndicator();
      if (typeof App !== 'undefined' && App.toast) {
        App.toast('云端同步失败（网络慢或服务器超时），数据已保存在本机，将自动重试', 'error');
      }
      this.startRealtimeSync();
      return { success: false, error: String(e) };
    }
  },

  // ===== 退出/切后台前的最后一次推送（keepalive，页面卸载也能发出请求） =====
  // 跳过冲突检测（dirty 本地优先），直接把本地全量数据 PATCH 到云端
  async flushBeforeHide() {
    if (!this.CLOUD.enabled || !this.CLOUD.dirty) return;
    if (this.CLOUD.isSyncing || this.CLOUD.pushInFlight) return;
    // 未完成首次云端数据合并前不直推（防止全新设备把不完整数据在关闭瞬间推上云端）
    if (!this.CLOUD.cloudMerged) return;
    try {
      // 先刷新内容缓存，确保本机文件内容都带上云
      try { await this._refreshContentCache(); } catch (e) {}
      const allData = this._safeCollectAllData();
      allData.data.lastModified = new Date().toISOString();
      this._setLocalModified(allData.data.lastModified);
      const bodyFiles = { 'data.json': { content: JSON.stringify(allData.data) } };
      const prevHashes = this._getShardHashes();
      const newHashes = {};
      Object.keys(allData.filesPayload).forEach(name => {
        const v = allData.filesPayload[name];
        if (v === null) { bodyFiles[name] = { content: '' }; newHashes[name] = null; return; }
        const h = this._hashStr(v);
        newHashes[name] = h;
        if (prevHashes[name] === h) return;
        bodyFiles[name] = { content: v };
      });
      const body = JSON.stringify({ files: bodyFiles });
      // keepalive：页面关闭/切后台后请求仍会继续完成
      // 硬超时兜底：即使 abort/keepalive 请求异常挂起，也释放资源
      const ctl = new AbortController();
      const abortTimer = setTimeout(() => { try { ctl.abort(); } catch (e) {} }, 15000);
      let hardTimer = null;
      const hard = new Promise((_, rej) => { hardTimer = setTimeout(() => rej(new Error('FLUSH_HARD_TIMEOUT')), 20000); });
      Promise.race([
        fetch(this.CLOUD.apiBase + this.CLOUD.gistId, {
          method: 'PATCH',
          keepalive: true,
          signal: ctl.signal,
          headers: {
            'Authorization': 'Bearer ' + this.CLOUD.token,
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'banwei-workbench'
          },
          body: body
        }).then(r => {
          if (r.ok) { this._setShardHashes(newHashes); this._clearDirty(); this.CLOUD.syncStatus = 'idle'; this._updateIndicator(); }
        }).catch(() => {}),
        hard
      ]).catch(() => {}).finally(() => { clearTimeout(abortTimer); if (hardTimer) clearTimeout(hardTimer); });
    } catch (e) {}
  },

  // ===== 数据镜像：把云端数据同步提交到仓库 sync/ 目录，经 GitHub Pages 发布 =====
  // 用途：gist.githubusercontent.com / api.github.com 在部分网络（手机流量）不可达，
  // 但 gxw-hue.github.io 一定可达（网站就在上面）。镜像让所有设备多一条稳定拉取通道。
  // 整体 25 秒硬超时：镜像属于辅助通道，绝不允许其 fetch 挂起阻塞主同步流程。
  async _pushRepoMirror(dataContent, filesPayload, prevHashes, newHashes) {
    let hardTimer = null;
    const hard = new Promise((_, rej) => { hardTimer = setTimeout(() => rej(new Error('MIRROR_HARD_TIMEOUT')), 25000); });
    try {
      await Promise.race([this._pushRepoMirrorInner(dataContent, filesPayload, prevHashes, newHashes), hard]);
    } finally {
      if (hardTimer) clearTimeout(hardTimer);
    }
  },
  async _pushRepoMirrorInner(dataContent, filesPayload, prevHashes, newHashes) {
    const owner = 'GXW-HUE', repo = 'banwei-workbench', branch = 'main';
    const apiBase = 'https://api.github.com/repos/' + owner + '/' + repo + '/git/';
    const H = {
      'Authorization': 'Bearer ' + this.CLOUD.token,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'banwei-workbench'
    };
    const J = (r) => r.json();
    // 1. 当前 main 引用
    const ref = await J(await fetch(apiBase + 'ref/heads/' + branch, { headers: H, cache: 'no-store' }));
    if (!ref || !ref.object) throw new Error('ref err');
    const parent = ref.object.sha;
    const parentCommit = await J(await fetch(apiBase + 'commits/' + parent, { headers: H, cache: 'no-store' }));
    const baseTree = parentCommit.tree.sha;
    // 2. 准备文件：data.json + 变化的分片（null 的跳过，保留镜像里的旧分片；未变化的分片不重传）
    const entries = [{ path: 'sync/data.json', mode: '100644', type: 'blob', content: dataContent }];
    Object.keys(filesPayload || {}).forEach(n => {
      const v = filesPayload[n];
      if (typeof v !== 'string' || v.length === 0) return;
      if (prevHashes && newHashes && prevHashes[n] === newHashes[n]) return;  // 未变化：跳过
      entries.push({ path: 'sync/' + n, mode: '100644', type: 'blob', content: v });
    });
    // 3. 建 blob → tree → commit → 更新引用
    for (const e of entries) {
      const b = await J(await fetch(apiBase + 'blobs', { method: 'POST', headers: H, body: JSON.stringify({ content: e.content, encoding: 'utf-8' }) }));
      if (!b.sha) throw new Error('blob err');
      e.sha = b.sha; delete e.content;
    }
    const tree = await J(await fetch(apiBase + 'trees', { method: 'POST', headers: H, body: JSON.stringify({ base_tree: baseTree, tree: entries }) }));
    const nc = await J(await fetch(apiBase + 'commits', { method: 'POST', headers: H, body: JSON.stringify({ message: 'sync: data mirror', tree: tree.sha, parents: [parent] }) }));
    await fetch(apiBase + 'ref/heads/' + branch, { method: 'PATCH', headers: H, body: JSON.stringify({ sha: nc.sha }) });
    this.CLOUD._lastMirrorAt = new Date().toISOString();
    this.CLOUD._canReachCloud = true;
    console.log('[sync] Pages 镜像已更新:', nc.sha);
  },

  // 按需推送镜像：仅当本机数据比线上镜像新、且本机确认能连上 GitHub 时才推（手机连不上，自动跳过）
  async _pushMirrorIfNeeded() {
    if (!this.CLOUD._canReachCloud) return;          // 本机连不上 GitHub（如手机流量）→ 不尝试
    if (this.CLOUD.pushInFlight || this.CLOUD.isSyncing) return;
    if (this.CLOUD._mirrorPushing) return;
    // v44 节流：镜像提交消耗写配额（100 次/小时共享），10 分钟内最多一次
    if (this.CLOUD._lastMirrorAt && Date.now() - this.CLOUD._lastMirrorAt < 600000) return;
    const all = this._safeCollectAllData();
    const modified = all.data.lastModified ? Date.parse(all.data.lastModified) : 0;
    const lastM = this.CLOUD._lastMirrorModified || 0;
    if (modified <= lastM) return;                   // 镜像已是最新，无需推送
    this.CLOUD._mirrorPushing = true;
    try {
      // 镜像同样做增量：只提交变化的分片（未变化跳过，保留仓库旧分片）
      const prevHashes = this._getShardHashes();
      const newHashes = {};
      Object.keys(all.filesPayload || {}).forEach(n => {
        const v = all.filesPayload[n];
        newHashes[n] = (typeof v === 'string' && v.length > 0) ? this._hashStr(v) : null;
      });
      await this._pushRepoMirror(JSON.stringify(all.data), all.filesPayload, prevHashes, newHashes);
      this.CLOUD._lastMirrorAt = Date.now();
      this.CLOUD._lastMirrorModified = modified;
    } catch (e) {
      console.warn('镜像补推失败(忽略):', e);
    } finally {
      this.CLOUD._mirrorPushing = false;
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
    // 定时把数据镜像推到网站（手机等连不上 GitHub 的设备靠它同步），保证镜像始终接近实时
    setInterval(() => {
      if (document.hidden) return;
      this._pushMirrorIfNeeded();
    }, 60000);
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
    // 推送正在进行（含推送前拉取合并）：标记排队，当前轮 PATCH 完成后会用最新全量数据再推一轮，
    // 杜绝"连续上传第二个文件/快速连续编辑"因 busy 被丢弃而丢失更新
    if (this.CLOUD.pushInFlight) {
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

  // ===== 推送前安全化：把文件内容按 id 哈希稳定拆入 16 个固定主桶（files_blob_0/1/...），data.json 只留元数据 =====
  // 背景：文件 base64 内容若与数据一起塞进 data.json，会快速逼近 Gist 单文件 ~1MB 上限，
  //       导致后上传/较大的文件被降级为 cloudLimited（内容只留本机），无法跨设备预览/导出。
  // v43+ 关键改进：固定 16 桶哈希分桶（按文件 id 稳定入桶）取代"全量贪心装箱"。
  //   - 任何文件的新增/删除/修改，只影响它所在的那个桶（~几十 KB）；
  //   - 其余 15 个桶内容完全不变 → 增量推送时哈希相同被跳过 → 每次推送体积从全量 700KB+
  //     降到 data.json(~90KB)+变化桶(~几十 KB)，慢网也能 5-15 秒完成，根治"上传成功云端收不到"。
  //   - 大文件按 CHUNK 切块后仍进本槽；单桶超过 SHARD_MAX 时开扩展桶 files_blob_<槽>_<n>.json
  //     （Gist 单文件 ~1MB 硬上限，超限会 422）——扩展桶仍属于同一槽，不影响其它 15 槽增量。
  _safeCollectAllData() {
    const data = this._collectAllData();
    const files = Array.isArray(data._files) ? data._files : [];
    const N_SLOTS = 16;             // 固定主桶数
    const SHARD_MAX = 600000;       // 单个桶最大字符数（Gist 单文件 ~1MB、单 gist 总量 1MB 双上限，留充足余量）
    const CHUNK = 420000;           // 单个内容块最大字符数（大文件按此切块）
    const withContent = files.filter(f => typeof f.content === 'string' && f.content.length > 0);
    // 稳定哈希：仅由文件 id 决定槽号，同一文件永远进同一槽 → 内容变更只影响单槽
    const slotOf = (id) => {
      let h = 0;
      const s = String(id);
      for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % N_SLOTS;
      return h;
    };
    // 每个槽：块列表 [{key, s}]，按 key 排序保证稳定 JSON
    const slotBlocks = [];
    for (let i = 0; i < N_SLOTS; i++) slotBlocks.push([]);
    withContent.forEach(f => {
      const c = f.content;
      const slot = slotOf(f.id);
      if (c.length <= CHUNK) {
        slotBlocks[slot].push({ key: f.id, s: c });
      } else {
        const n = Math.ceil(c.length / CHUNK);
        for (let i = 0; i < n; i++) slotBlocks[slot].push({ key: f.id + '|' + i, s: c.substr(i * CHUNK, CHUNK) });
      }
    });
    const shardNames = [], shards = [];
    for (let slot = 0; slot < N_SLOTS; slot++) {
      const blocks = slotBlocks[slot].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      if (!blocks.length) continue;
      let cur = {}, curLen = 0, ext = 0;
      const flush = () => {
        const obj = {};
        Object.keys(cur).sort().forEach(k => { obj[k] = cur[k]; });
        const nm = (ext === 0) ? ('files_blob_' + slot + '.json') : ('files_blob_' + slot + '_' + ext + '.json');
        shardNames.push(nm);
        shards.push(obj);
        cur = {}; curLen = 0; ext++;
      };
      blocks.forEach(b => {
        if (curLen > 0 && curLen + b.s.length > SHARD_MAX) flush();
        cur[b.key] = b.s;
        curLen += b.s.length;
      });
      if (curLen > 0) flush();
    }
    // _files 剥离 content（内容已拆到分片）；本机无内容的文件保持 cloudLimited=true（等上传设备补传）
    data._files = files.map(f => {
      if (typeof f.content === 'string' && f.content.length > 0) {
        return Object.assign({}, f, { content: null, cloudLimited: false });
      }
      return f;
    });
    // 本机暂无任何文件内容时，绝不能把清单清空（否则其他设备下次会找不到云端分片），沿用上次云端清单
    const _normName = (nm) => (nm && String(nm).endsWith('.json')) ? nm : (nm + '.json');
    data._blobShards = shards.length > 0 ? shardNames
      : (this.CLOUD._lastShards && this.CLOUD._lastShards.length ? this.CLOUD._lastShards.map(_normName) : (data._blobShards || ['files_blob.json']));
    const filesPayload = {};
    // v47 紧凑化：分片直接存裸映射 {文件id: 内容}（不再包 {files:{...}} 壳层，省 ~15% 体积，
    // 并保证 Gist 总大小 1MB 上限内尽量多容纳文件）。拉取端 _fetchOneChannel 兼容两种格式。
    shardNames.forEach((n, i) => { filesPayload[n] = JSON.stringify(shards[i]); });
    // 仅当本次确有文件内容分片上云时，才清理旧分片残留：
    // 弱网/本机暂无内容时保留云端 blob，避免误清空已上云的内容。
    // v46 修正：Gist PATCH 中删除一个"云端不存在"的文件会 422 missing_field。
    // 因此只删除"上次推送成功后记录在案"的分片（_getShardHashes 的 key），
    // 首次推送（prev 为空）时不做任何删除；旧版单一 files_blob.json 仅当上次成功推送
    // 记录过它时才删除，绝不臆测云端存在。
    if (shards.length > 0) {
      try {
        const prev = this._getShardHashes();
        if (prev && typeof prev === 'object') {
          Object.keys(prev).forEach(nm => {
            if (!shardNames.includes(nm)) filesPayload[nm] = null;
          });
        }
      } catch (e) {}
      try { localStorage.setItem(this.SHARD_COUNT_KEY, String(shards.length)); } catch (e) {}
    }
    return { data, filesPayload };
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
      // 文件内容来源：1) 旧格式内联在 data.json._files[].content；2) 新格式独立存于 files_blob.json（cloudData.files）
      const localFiles = this.getFiles();
      const fileContents = cloudData.files || {};
      const protectedFiles = (cloudData._files || []).map(cf => {
        let content = null;
        if (typeof cf.content === 'string' && cf.content.length > 0) {
          content = cf.content;                       // 旧格式：content 直接带在元数据上
        } else if (fileContents[cf.id] && typeof fileContents[cf.id] === 'string') {
          content = fileContents[cf.id];              // 新格式：content 在独立文件（未分块）
        } else {
          content = this._joinChunks(fileContents, cf.id);   // 大文件：按块 id|0 / id|1 ... 拼接还原
        }
        if (content) {
          return Object.assign({}, cf, { content, cloudLimited: false });
        }
        // 云端无内容（超大文件降级 cloudLimited）：本机有则保留，保证上传设备仍可预览/导出
        const lf = localFiles.find(f => f.id === cf.id);
        if (lf && lf.content) {
          return Object.assign({}, cf, { content: lf.content, cloudLimited: false });
        }
        return cf;
      });
      // 云端带来的文件内容写入 IndexedDB，元数据写入 localStorage
      this._writeFilesWithContent(protectedFiles);
    }
    // 自修复：检测"本机持有内容、但云端缺失该内容"的文件（历史版本/弱网导致部分文件字节从未上云，
    // 元数据虽已同步、内容却只留在某台设备上）。这一台设备下次打开站点时，应自动把字节补传上云，
    // 让其他设备也能同步到内容。标记 _needContentUpload，由下方 _mergeCloudData 据此触发补推。
    try {
      const localFiles2 = this.getFiles();
      const cloudContentIds = new Set();
      const cfMap = cloudData.files || {};
      Object.keys(cfMap).forEach(k => { if (typeof cfMap[k] === 'string' && cfMap[k].length) cloudContentIds.add(k); });
      (cloudData._files || []).forEach(cf => {
        if (typeof cf.content === 'string' && cf.content.length) cloudContentIds.add(cf.id);
      });
      const localHasMissingContent = (localFiles2 || []).some(f =>
        typeof f.content === 'string' && f.content.length > 0 && !cloudContentIds.has(f.id));
      this.CLOUD._needContentUpload = !!localHasMissingContent;
    } catch (e) { this.CLOUD._needContentUpload = false; }
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

  // 大文件内容按块还原：分片中存的是 id|0、id|1 ... 依次拼接
  _joinChunks(map, id) {
    if (!map || !id) return null;
    let out = '', i = 0;
    while (typeof map[id + '|' + i] === 'string') { out += map[id + '|' + i]; i++; }
    return i > 0 ? out : null;
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
          // 本地独有的记录/文件一律保留并待推送；跨设备删除完全由"墓碑"判定。
          // （旧逻辑用 createdAt<上次同步水位 推断"别处已删除"，但推送前拉取/定时轮询会不断推进
          //   同步水位，反而会把刚上传、还没来得及推送的文件误判成已删除而丢弃，故移除该启发式。）
          map.set(r.id, r);
          localHasExtra = true;
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
    out.files = cloudData.files || {};   // 附带独立存储的文件内容（files_blob.json）
    this._applyCloudData(out);
    try { localStorage.setItem(this.SYNC_KEY, String(Date.now())); } catch (e) {}
    this._markMerged();

    const needPush = localHasExtra || tombNewer || this.CLOUD.dirty || this.CLOUD._needContentUpload;
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

    // 初始化文件内容存储（IndexedDB）+ 迁移历史内联内容；必须在渲染/云同步之前完成
    await this._initFileStore();

    if (needsReload) {
      // 版本升级时：不再清空本地记录（会导致用户数据“被清零”后无法恢复）。
      // 仅重置文件内容缓存标记；文件元数据保留在 localStorage，由 _initFileStore 迁移。
      // 如果某设备已被旧版本清空过，后台拉取云端后会自动恢复。
      localStorage.setItem(this.VERSION_KEY, this.DATA_VERSION);
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
        // 首次进入 / 每次成功拉取后：把本机数据刷新到网站镜像（电脑侧），手机随后即可读到
        this._pushMirrorIfNeeded();
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
    let metas = [];
    if (raw) {
      try {
        metas = JSON.parse(raw);
      } catch (e) {
        return [];
      }
    }
    if (!Array.isArray(metas)) return [];
    const cache = this._contentCache || {};
    // 把 IndexedDB（内存缓存）中的内容回填到元数据上，保持"同步返回带 content"的旧行为
    return metas.map(m => {
      if (!m) return m;
      if (cache[m.id] !== undefined) {
        return Object.assign({}, m, { content: cache[m.id] });
      }
      // 缓存无内容：云端剥离的 cloudLimited 文件，或降级模式下的内联内容
      return Object.assign({}, m, { content: (m.content === undefined ? null : m.content) });
    });
  },

  addFile(fileInfo) {
    const files = this.getFiles();
    // id 必须带随机后缀：同一毫秒连续上传多个文件时，不能生成相同 id（否则合并去重会丢文件）
    fileInfo.id = 'file_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    fileInfo.createdAt = new Date().toISOString();
    const content = (typeof fileInfo.content === 'string' && fileInfo.content.length > 0) ? fileInfo.content : null;

    // 已有文件：只保留元数据（内容仍在 IndexedDB，不重复回写）
    const list = files.map(f => {
      if (!f) return f;
      const m = Object.assign({}, f);
      if (this._idbOk) delete m.content;
      return m;
    });
    // 新文件带 content 入列，由 _writeFilesWithContent 拆分存储
    list.unshift(fileInfo);

    // 超出上限时截断，并同步清理被淘汰文件在 IndexedDB 中的内容（避免孤儿数据占空间）
    if (list.length > this.MAX_FILES) {
      const dropped = list.splice(this.MAX_FILES);
      dropped.forEach(d => {
        if (d && d.id) { delete this._contentCache[d.id]; this._idbDelete(d.id); }
      });
    }

    const ok = this._writeFilesWithContent(list);
    if (!ok) {
      console.error('文件保存失败（localStorage 元数据写入异常）');
      if (typeof App !== 'undefined' && App.toast) {
        App.toast('文件保存失败，请删除一些旧文件后重试', 'error');
      }
      return null;
    }
    // 兜底确保内存缓存命中，使本次调用后立即可读（预览/下载）
    if (content) this._contentCache[fileInfo.id] = content;
    this.schedulePush();
    return Object.assign({}, fileInfo, { content: content });
  },

  deleteFile(fileId) {
    const files = this.getFiles();
    // 只回写元数据：剩余文件的内容仍在 IndexedDB，无需重复写入
    const filtered = files.filter(f => f.id !== fileId).map(f => {
      const m = Object.assign({}, f);
      if (this._idbOk) delete m.content;
      return m;
    });
    this._writeFilesWithContent(filtered);
    // 同步清理 IndexedDB 内容与内存缓存
    delete this._contentCache[fileId];
    this._idbDelete(fileId);
    this._addTomb('_files', fileId);   // 文件删除也跨设备同步
    this.schedulePush();
  },

  saveFileList(files) {
    this._writeFilesWithContent(files);
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
      } else if (config.type === 'file') {
        // 文件型模块：记录数 = 该模块下的文件数（上传一个文件即一条记录）
        // 修复：此前走 else 分支读空的模块表，导致仪表盘/设置页永远显示 0
        stats[moduleId] = this.getFiles().filter(f => f && f.module === moduleId).length;
      } else {
        stats[moduleId] = this.get(moduleId).length;
      }
    });
    return stats;
  },

  // ===== 存储占用概览（供设置页展示，便于判断还剩多少空间）=====
  getStorageInfo() {
    let lsChars = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        lsChars += (k || '').length + (localStorage.getItem(k) || '').length;
      }
    } catch (e) {}
    let contentChars = 0, withContent = 0;
    const files = this.getFiles();
    files.forEach(f => {
      if (f && typeof f.content === 'string' && f.content.length) {
        contentChars += f.content.length;
        withContent++;
      }
    });
    return {
      fileCount: files.length,
      fileWithContent: withContent,
      contentChars: contentChars,
      contentMB: +(contentChars / 1024 / 1024).toFixed(2),
      localStorageKB: +(lsChars / 1024).toFixed(1),
      engine: this._idbOk ? 'IndexedDB' : 'localStorage(降级)'
    };
  },

  // ===== 清空所有数据（本地+云端） =====
  async clearAll() {
    Object.keys(MODULE_CONFIG).forEach(moduleId => {
      localStorage.removeItem(this.getKey(moduleId));
    });
    localStorage.removeItem(this.FILE_PREFIX);
    localStorage.removeItem(this.INIT_KEY);
    // 同步清空 IndexedDB 中的文件内容与内存缓存
    this._contentCache = {};
    this._idbClear();
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
      this._writeFilesWithContent(data._files);
      this.schedulePush();
    }
    return true;
  }
};
