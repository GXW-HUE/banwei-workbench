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
    apiBase: 'https://api.github.com/gists/',
    workerBase: 'https://banwei-sync-api.pages.dev/gists/',
    mirrorBase: 'https://banwei-sync-api.pages.dev/mirror',
    debounceMs: 800,       // 修改后防抖推送间隔（快速推送，防退出丢失）
    lastPushTime: 0,
    pushTimer: null,
    isSyncing: false,
    pushPromise: null,     // 并发触发的同步复用同一轮结果，不把 busy 误报成上传失败
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
    const writes = [];
    list.forEach(f => {
      if (!f) return;
      const m = Object.assign({}, f);
      const content = typeof m.content === 'string' && m.content.length > 0 ? m.content : null;
      if (content) {
        m.hasContent = true;
        m.contentChars = content.length;
        this._contentCache[m.id] = content;
        if (this._idbOk) {
          writes.push({ id: m.id, content, promise: this._idbPut(m.id, content) });
          delete m.content;
        } else m.content = content;
      } else if (this._idbOk) delete m.content;
      metas.push(m);
    });
    try { localStorage.setItem(this.FILE_PREFIX, JSON.stringify(metas)); }
    catch (e) { console.error('文件元数据写入失败:', e); return false; }
    if (writes.length) {
      const persist = Promise.all(writes.map(w => w.promise)).then(async results => {
        if (results.every(Boolean)) return true;
        const retries = await Promise.all(writes.map((w, i) => results[i] ? Promise.resolve(true) : this._idbPut(w.id, w.content)));
        return retries.every(Boolean);
      }).catch(() => false);
      this._lastFilePersist = persist;
      persist.then(ok => {
        if (ok) {
          // 一次性的 IndexedDB 写入失败不能把后续所有上传永久锁死。
          // 成功重试后清除错误标记，下一次推送即可恢复云端同步。
          this.CLOUD._filePersistFailed = false;
        } else {
          this.CLOUD._filePersistFailed = true;
          this.CLOUD.syncStatus = 'error';
          this._updateIndicator();
          if (typeof App !== 'undefined' && App.toast) App.toast('文件仅保存在当前设备，云端同步失败，请勿清理本机数据', 'error');
        }
      });
    }
    return true;
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

  // ===== 云同步通道 =====
  // 设计（v53 重写，彻底修复“多端不同步 / 分片解析为 0 / 双主漂移”）：
  // 所有设备只读同一份单文件 sync/data.json（含全部数据与文件内容），不再分片、不再多份数据漂移。
  // 电脑端每次推送都会把“完全一致的同一份数据”同时写入 gist 与 Pages 镜像，二者永远一致。
  //   · pages：GitHub Pages 镜像（手机/电脑都稳定可达，单文件含完整数据，无 CDN 旧分片残留问题）
  //   · api ：Gist API 直连（桌面可达、即时无缓存；超大文件内容被 1MB 限制裁剪时自动回退镜像补齐）
  // 仅 2 个通道，逻辑极简：谁的内容完整、谁最新，就采用谁。
  _buildChannels() {
    const ts = Date.now();
    const mirrorBase = 'https://gxw-hue.github.io/banwei-workbench/sync/';
    return [
      // 轻量索引（几十 KB，记录 + 文件元数据）：手机先拿到它就能秒开、编辑也能秒推。
      // 附件正文占云端 99%，不再随每次改动搬运。
      { name: 'index', url: this.CLOUD.workerBase + this.CLOUD.gistId + '?index=1', api: false, index: true, headers: {} },
      { name: 'index-mirror', url: mirrorBase + 'index.json?t=' + ts, api: false, index: true, headers: {} },
      { name: 'worker', url: this.CLOUD.workerBase + this.CLOUD.gistId + '?meta=1', api: true,
        headers: {} },
      { name: 'api',   url: this.CLOUD.apiBase + this.CLOUD.gistId, api: true,
        headers: { 'Accept': 'application/vnd.github.v3+json' } }
    ];
  },

  // 单通道拉取（独立超时，可被外部 abort）
  // v53 单文件方案：每个通道只拉取同一个 data.json（文件内容已内联/分块在文件内部），
  // 不再有独立分片文件，从根上消除“分片解析为 0 键 / 漏拉 / CDN 旧分片”等 bug。
  // 从镜像补齐旧分片格式的文件内容（过渡期：云端仍是 _blobShards 分片时调用）
  async _loadShardsFromMirror(blobShards, ctl, _headers) {
    const mirrorBase = 'https://gxw-hue.github.io/banwei-workbench/sync/';
    const norm = (nm) => (nm && String(nm).endsWith('.json')) ? nm : (nm + '.json');
    const merged = {};
    await Promise.all(blobShards.map(norm).map(async (nm) => {
      try {
        const r = await fetch(mirrorBase + nm + '?t=' + Date.now(), { signal: ctl.signal, headers: _headers, cache: 'no-store' });
        if (r.ok) {
          const j = JSON.parse(await r.text());
          const map = (j && j.files && typeof j.files === 'object') ? j.files : j;
          if (map && typeof map === 'object') Object.assign(merged, map);
        }
      } catch (e) {}
    }));
    return merged;
  },

  // 单通道拉取（独立超时，可被外部 abort）
  // v53 单文件方案：每个通道只拉取同一个 data.json（文件内容已内联/分块在文件内部），
  // 不再有独立分片文件，从根上消除“分片解析为 0 键 / 漏拉 / CDN 旧分片”等 bug。
  // api 通道读取 Gist API 对象（files['data.json'].content + 内部分片 files_blob_*），
  // 非 api 通道读取镜像 data.json；两者均兼容“云端仍是旧 _blobShards 分片格式”的过渡场景。
  async _fetchOneChannel(ch, timeoutMs, controller) {
    const ctl = controller || new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const _headers = Object.assign({ 'User-Agent': 'banwei-workbench', 'Accept': 'application/json' }, ch.headers || {});
    try {
      const resp = await fetch(ch.url, { signal: ctl.signal, headers: _headers, cache: 'no-store' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      let data;
      if (ch.index) {
        // 轻量索引通道：几十 KB，直接是索引对象（也兼容包在 files['index.json'].content 里的形式）
        const body = JSON.parse(await resp.text());
        if (body && body.files && body.files['index.json'] && typeof body.files['index.json'].content === 'string') {
          data = JSON.parse(body.files['index.json'].content);
        } else {
          data = body;
        }
      } else if (ch.api) {
        // api 通道：Gist API 返回 gist 对象 { files: { 'data.json': {content}, 'files_blob_0': {content}, ... } }
        const gist = JSON.parse(await resp.text());
        const dataFile = gist.files && gist.files['data.json'];
        if (!dataFile) throw new Error('Gist data.json missing; refusing to treat this as an empty cloud');
        const readFile = async (file) => {
          if (!file.truncated) return file.content || '';
          const url = new URL(file.raw_url);
          if (url.protocol !== 'https:' || url.hostname !== 'gist.githubusercontent.com') {
            throw new Error('Unexpected Gist raw URL');
          }
          // Raw downloads must not receive the GitHub API credential.
          const raw = await fetch(url.href, { signal: ctl.signal, cache: 'no-store' });
          if (!raw.ok) throw new Error('Gist raw HTTP ' + raw.status);
          return raw.text();
        };
        data = JSON.parse(await readFile(dataFile));
        // 合并 Gist 内部分片（files_blob_* 直接挂在 gist.files 上，分片格式云端时存在）
        const chunks = {};
        for (const n of Object.keys(gist.files)) {
          if (n === 'data.json') continue;
          if (n.indexOf('files_blob') === 0) {
            try {
              const j = JSON.parse(await readFile(gist.files[n]));
              const map = (j && j.files && typeof j.files === 'object') ? j.files : j;
              if (map && typeof map === 'object') Object.assign(chunks, map);
            } catch (e2) { throw new Error('Gist attachment download failed: ' + e2.message); }
          }
        }
        if (!data._fileChunks) data._fileChunks = chunks;
        // 兜底：云端仍是旧 _blobShards 分片格式（分片不在 gist.files 内，需从镜像补）
        if (Array.isArray(data._blobShards) && data._blobShards.length && Object.keys(chunks).length === 0) {
          data._fileChunks = await this._loadShardsFromMirror(data._blobShards, ctl, _headers);
        }
      } else {
        data = JSON.parse(await resp.text());
        // 旧格式兼容：云端仍是分片格式（_blobShards）且缺 _fileChunks，从镜像补齐
        if (Array.isArray(data._blobShards) && data._blobShards.length && !data._fileChunks) {
          data._fileChunks = await this._loadShardsFromMirror(data._blobShards, ctl, _headers);
        }
      }
      return { success: true, hasData: true, data, channel: ch.name };
    } catch (e) {
      return { success: false, error: String(e) };
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
    // 阈值取 70s：覆盖国内弱网下镜像（GitHub Pages）的慢速响应，正常网络几秒即可完成。
    const guard = new Promise((_, rej) => setTimeout(() => rej(new Error('pull guard timeout')), 140000));
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
      // 仅当快速结果比本地新时才先应用（防止缓存旧数据导致回退）
      const cloudM = r.data && r.data.lastModified ? Date.parse(r.data.lastModified) : 0;
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
    try {
      const successes = [];
      const errors = [];
      const isComplete = (data) => {
        if (!data || !Array.isArray(data._files)) return false;
        if (data._metaOnly || data._indexOnly) return true;
        const chunks = data._fileChunks || {};
        return data._files.every(file => {
          if (!file || file.cloudLimited || !file.hasContent) return !file || !file.cloudLimited;
          if (typeof file.content === 'string' && file.content.length) return true;
          const count = Number(file.contentChunkCount) || 0;
          if (!count) return false;
          let length = 0;
          for (let i = 0; i < count; i++) {
            const piece = chunks[file.id + '|' + i];
            if (typeof piece !== 'string') return false;
            length += piece.length;
          }
          return !file.contentLength || length === file.contentLength;
        });
      };
      // Large cloud snapshots can exhaust memory when three 9 MB copies download at once in WeChat.
      // Read the primary proxy first and only use fallbacks when it fails or omits file content.
      for (let i = 0; i < channels.length; i++) {
        try {
          const r = await this._fetchOneChannel(channels[i], channels[i].api ? 110000 : 50000, controllers[i]);
          if (!r.success) throw new Error('empty');
          successes.push(r);
          if (r.hasData) fireQuick(r);
          if (r.hasData && isComplete(r.data)) break;
        } catch (e) { errors.push(String(e).slice(0, 80)); }
      }
      if (successes.length === 0) {
        throw new Error('all channels failed: ' + errors.join(' | '));
      }
      this.CLOUD.cloudChecked = true;
      this.CLOUD.initialPulling = false;
      this.CLOUD._lastPullOkAt = Date.now();
      const withData = successes.filter(r => r.hasData && r.data);
      // 评估“内容完整度 + 新鲜度”：文件内容（内联 + 分块）数量最多者优先，并列则取 lastModified 最新。
      // 由于 gist 与镜像现在都是同一份单文件，绝大多数情况下二者完全一致；
      // 仅在 gist 因 1MB 限制裁剪了文件内容时，自动让位给完整的镜像通道。
      const assess = (r) => {
        const d = r.data || {};
        const chunks = d._fileChunks || {};
        const inline = (d._files || []).filter(f => f && typeof f.content === 'string' && f.content.length > 0).length;
        return {
          contentCount: Object.keys(chunks).length + inline,
          m: d.lastModified ? Date.parse(d.lastModified) : 0,
          trimmed: !!d._gistTrimmed
        };
      };
      withData.sort((a, b) => {
        const A = assess(a), B = assess(b);
        if (A.contentCount !== B.contentCount) return B.contentCount - A.contentCount;
        return B.m - A.m;
      });
      let best = withData[0];
      if (best && best.data._gistTrimmed) {
        const mirror = withData.find(r => r.channel === 'pages' && !r.data._gistTrimmed);
        if (mirror) best = mirror;
      }
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
  async _pushOnce(body) {
    const targets = [
      { url: this.CLOUD.workerBase + this.CLOUD.gistId, headers: {} },
      { url: this.CLOUD.apiBase + this.CLOUD.gistId, headers: {} }
    ];
    let lastError;
    for (const target of targets) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 110000);
      try {
        const resp = await fetch(target.url, {
          method: 'PATCH', signal: ctl.signal,
          headers: Object.assign({ 'Content-Type': 'application/json',
            Accept: 'application/vnd.github.v3+json' }, target.headers),
          body: JSON.stringify(body)
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const result = await resp.json().catch(() => null);
        // 校验每个上传的文件确实落库。
        // 注意：GitHub 对 >1MB 的文件在 PATCH 响应里只回前 1MB（truncated:true），
        // 旧代码拿 content.length 直接比对，大包必然判为“截断”从而永远重试失败——
        // 这是 10MB 数据长期推不上 Gist、只能退回镜像的根因之一。
        // 现在 truncated 时改用响应里的 size（字节数）校验，UTF-8 下 size 必然 >= 字符数。
        if (body && body.files && result && result.files) {
          for (const name of Object.keys(body.files)) {
            const sent = body.files[name] && body.files[name].content;
            const got = result.files[name];
            if (typeof sent !== 'string' || !got) continue;
            if (got.truncated) {
              const size = Number(got.size) || 0;
              if (size > 0 && size < sent.length) throw new Error('Gist stored suspiciously small file: ' + name);
              continue;
            }
            const back = typeof got.content === 'string' ? got.content : '';
            if (back && back.length < sent.length) throw new Error('Gist returned truncated data: ' + name);
          }
        }
        return true;
      } catch (e) { lastError = e; }
      finally { clearTimeout(timer); }
    }
    throw lastError;
  },

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); },

  pushToCloud() {
    if (this.CLOUD.pushPromise) return this.CLOUD.pushPromise;
    const operation = this._pushToCloudImpl();
    this.CLOUD.pushPromise = operation;
    const clear = () => { if (this.CLOUD.pushPromise === operation) this.CLOUD.pushPromise = null; };
    operation.then(clear, clear);
    return operation;
  },

  async _pushToCloudImpl() {
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
        if (this._lastFilePersist) {
          const persisted = await this._lastFilePersist;
          if (!persisted || this.CLOUD._filePersistFailed) throw new Error('文件内容尚未可靠保存，拒绝标记同步成功');
        }
        try { await this._refreshContentCache(); } catch (e) {}
        let allData = this._safeCollectAllData();
        allData.data.lastModified = new Date().toISOString();
        this._setLocalModified(allData.data.lastModified);
        // 附件集合没变时不再重传 10MB 的 data.json，只推几十 KB 的 index.json——
        // 手机改一条记录也能几秒内同步成功（此前每次编辑都要背全量附件，弱网必失败）。
        // data.json 仍保持完整格式，老设备/旧缓存读取不受影响。
        const filesSig = this._filesSignature(allData.data._files);
        const lastSig = localStorage.getItem(this.PREFIX + '_files_sig') || '';
        // 本机是否真的持有附件正文：_refreshContentCache() 已把 IndexedDB 正文装进 _contentCache。
        // 旧实现用 _collectAllData()._fileChunks 判断，而元数据里的正文始终为空 →
        // 永远判定“本机没有正文” → 新增附件只推 index.json，data.json 一直没有正文，
        // 其他设备看到“有文件、点开没内容/下载失败”。这是跨端文件不同步的根因。
        const localHasContent = Object.keys(this._contentCache || {}).length > 0;
        let needFull = localHasContent && (!lastSig || lastSig !== filesSig || this.CLOUD._needContentUpload);
        let fullReady = !needFull;
        if (needFull) {
          try {
            // 补正文：优先用本机 IndexedDB 缓存，只有本机确实没有的文件才去云端下载
            const expectedFiles = await this._hydrateFilesForPush(this.getFiles());
            allData = this._safeCollectAllData();
            allData.data.lastModified = new Date().toISOString();
            fullReady = this._validateCloudFilePayload(allData.data, expectedFiles);
            if (!fullReady) console.warn('附件正文校验未通过，本轮不推索引，避免索引指向缺失内容');
          } catch (e) {
            console.warn('附件正文不可用，本轮不推索引（稍后重试）:', e);
            fullReady = false;
          }
        }
        const fullContent = JSON.stringify(allData.data, null, 2);
        const indexContent = JSON.stringify(allData.indexData, null, 2);
        let lastErr = null;
        const pushOneFile = async (name, content) => {
          for (let attempt = 0; attempt < 5; attempt++) {
            try { await this._pushOnce({ files: { [name]: { content } } }); return true; } catch (e) {
              lastErr = e;
              console.warn('Gist 推送 ' + name + ' 第 ' + (attempt + 1) + ' 次失败:', e);
              if (attempt < 4) await this._sleep(1000 * Math.pow(2, attempt));
            }
          }
          return false;
        };
        // 先传附件正文（大），再传索引，保证任何设备读到索引时正文已就绪。
        // 正文没准备好/上传失败时绝不写索引：索引领先于正文 = 其他设备看到“有记录、没内容”。
        if (needFull && !fullReady) {
          throw new Error('附件正文尚未就绪，暂不推送索引');
        }
        if (needFull) {
          const okFull = await pushOneFile('data.json', fullContent);
          if (!okFull) throw new Error('附件正文上传失败，暂不推送索引');
          try { localStorage.setItem(this.PREFIX + '_files_sig', filesSig); } catch (e) {}
          this.CLOUD._needContentUpload = false;
        }
        const gistOk = await pushOneFile('index.json', indexContent);
        if (!gistOk) console.warn('Gist 推送最终失败（镜像仍会同步）:', lastErr);
        else this.CLOUD._canReachCloud = true;
        this.CLOUD.lastPushTime = Date.now();
        this.CLOUD.lastSyncTime = new Date().toISOString();
        // 2) 写 Pages 镜像（仓库）：手机等连不上 GitHub 的设备从此处读取“完整单文件数据”（含文件内容）。
        //    电脑/手机最终都读这一份，确保双端永远一致。
        let mirrorOk = false;
        try {
          await this._pushRepoMirror(indexContent);
          mirrorOk = true;
          this.CLOUD._lastMirrorModified = Date.parse(allData.data.lastModified) || Date.now();
          this.CLOUD._canReachCloud = true;
        } catch (e) { console.warn('镜像提交失败，保留待同步状态:', e); }
        // Gist/Worker 是主同步通道，Pages 只是手机端的备用镜像。
        // 主通道成功即可确认数据已到云端；镜像失败留给后台轮询补推，
        // 避免因 GitHub Pages 提交短暂冲突把已经成功的上传误报为失败。
        if (!gistOk && !mirrorOk) {
          throw new Error('所有上传通道失败');
        }
        // 推送进行中又收到新改动 → 用最新全量数据再推一轮（最多 6 轮兜底，极端情况下次轮询补齐）
        if (this.CLOUD.pendingPush) {
          if (rounds < 6) continue;
          throw new Error('仍有新改动待上传，保留重试队列');
        }
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
      this.startRealtimeSync();
      return { success: false, error: String(e) };
    }
  },

  // ===== 退出/切后台前的最后一次推送（keepalive，页面卸载也能发出请求） =====
  // 跳过冲突检测（dirty 本地优先），直接把本地全量数据 PATCH 到云端
  async flushBeforeHide() {
    if (!this.CLOUD.enabled || !this.CLOUD.dirty) return;
    // Keep the persisted retry marker. The normal queue handles merge and mirror writes.
    // A direct unload PATCH could overwrite another device and clear dirty before the mirror exists.
    return this.pushToCloud();
  },

  // ===== 数据镜像：把云端数据同步提交到仓库 sync/ 目录，经 GitHub Pages 发布 =====
  // 用途：gist.githubusercontent.com / api.github.com 在部分网络（手机流量）不可达，
  // 但 gxw-hue.github.io 一定可达（网站就在上面）。镜像让所有设备多一条稳定拉取通道。
  // 镜像推送：把“完整的单文件 data.json”提交到仓库 sync/ 目录，经 GitHub Pages 发布。
  // 注意：GitHub 更新引用的正确端点是 refs/heads/<branch>（复数 refs），
  // 旧版错用 ref/heads/（单数）会稳定返回 404，导致镜像从未真正更新——这是多端不同步的隐藏根因之一。
  async _pushRepoMirror(dataContent) {
    const resp = await fetch(this.CLOUD.mirrorBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: dataContent, name: 'index.json' }),
      cache: 'no-store'
    });
    if (!resp.ok) throw new Error('Cloud mirror HTTP ' + resp.status);
    const result = await resp.json().catch(() => ({}));
    this.CLOUD._lastMirrorAt = new Date().toISOString();
    this.CLOUD._canReachCloud = true;
    console.log('[sync] Pages 镜像已更新:', result.sha || 'ok');
  },

  // 按需推送镜像：仅当本机数据比线上镜像新、且本机确认能连上 GitHub 时才推（手机连不上，自动跳过）
  async _pushMirrorIfNeeded() {
    if (!this.CLOUD._canReachCloud) return;          // 本机连不上 GitHub（如手机流量）→ 不尝试
    if (this.CLOUD.pushInFlight || this.CLOUD.isSyncing) return;
    if (this.CLOUD._mirrorPushing) return;
    const all = this._safeCollectAllData();
    const modified = all.data.lastModified ? Date.parse(all.data.lastModified) : 0;
    const lastM = this.CLOUD._lastMirrorModified || 0;
    if (modified <= lastM) return;                   // 镜像已是最新，无需推送
    this.CLOUD._mirrorPushing = true;
    try {
      await this._pushRepoMirror(JSON.stringify(all.indexData, null, 2));
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
    // 页面开着时每 10s 自动检查其他设备的新数据（只拉轻量索引，约 2-3 秒）
    setInterval(() => {
      if (!document.hidden && !this.CLOUD.isSyncing && !this.CLOUD.pushInFlight) this._foregroundSync();
    }, 10000);
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
    // 注意：_lastPullAt 是给面板显示的 ISO 字符串，不能拿来做数值间隔判断，
    // 否则 now - '2026-...' 得到 NaN，节流形同虚设。
    if (this.CLOUD._lastForegroundAt && now - this.CLOUD._lastForegroundAt < 8000) return;
    this.CLOUD._lastForegroundAt = now;
    // 云端快照指纹：用于“只在数据真的变了才重绘”，避免每轮轮询都把页面重绘一次
    const digest = (d) => {
      if (!d) return '';
      let n = 0;
      Object.keys(MODULE_CONFIG).forEach(m => { if (Array.isArray(d[m])) n += d[m].length; });
      return (d.lastModified || '') + '|' + n + '|' + (Array.isArray(d._files) ? d._files.length : 0);
    };
    const applyResult = (result) => {
      if (!result || !result.success || !result.hasData || !result.data) return;
      const dg = digest(result.data);
      if (dg && dg === this.CLOUD._lastAppliedDigest && !this.CLOUD._renderPending) return;
      const merged = this._mergeCloudData(result.data);
      if (!merged) return;
      this.CLOUD._lastAppliedDigest = dg;
      // 用户正在表单里输入/弹窗中：先合并数据，等下次轮询再刷新界面，避免打断输入
      const editing = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      const modal = document.querySelector('.modal.show, .modal-mask.show, .modal.active');
      if (editing || modal) { this.CLOUD._renderPending = true; return; }
      this.CLOUD._renderPending = false;
      if (window.App && window.App.renderModule) {
        try { window.App.renderModule(window.App.currentModule || 'dashboard'); } catch (e) {}
      }
    };
    // 最快通道先返回先渲染，全部通道完成后再用最新数据校正一次
    const result = await this.fetchFromCloud((q) => applyResult(q));
    applyResult(result);
    // 云端确认为空（全新班级）或拉取成功：首拉阶段结束，允许后续推送
    if (result.success && !result.hasData) this._markMerged();
    // 自愈：本机曾成功整包推送过附件（有 _files_sig），但当前附件指纹与它不一致 →
    // 说明云端的 data.json 缺正文（历史上索引先于正文写入造成），立即补推一次整包。
    try {
      const lastSig = localStorage.getItem(this.PREFIX + '_files_sig') || '';
      if (!this.CLOUD._sigCheckedAt && this._idbOk) {
        this.CLOUD._sigCheckedAt = Date.now();
        await this._refreshContentCache();
        const cachedCount = Object.keys(this._contentCache || {}).length;
        const sig = this._filesSignature(this.getFiles());
        // 本机确实存着多份附件正文，且指纹与上次成功整包推送不一致（含从未记录签名）→ 补推整包
        if (cachedCount >= 5 && sig && (!lastSig || sig !== lastSig)) this._setDirty();
      }
    } catch (e) {}
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

  // ===== 推送前打包：单文件方案（v53）=====
  // 把“全部模块数据 + 文件内容”打包进同一个 data.json。文件内容：
  //   · 小文件（≤ CHUNK）：直接内联到 _files[].content（单文件自包含，最稳）；
  //   · 大文件（> CHUNK）：拆块进 _fileChunks（id|0 / id|1 ...），元数据只留标记。
  // 仓库（Pages 镜像）无单文件体积限制，可承载；Gist 单文件 ~1MB 上限由 pushToCloud 负责兜底（超限则裁剪内容、以镜像为准）。
  // 彻底取消分片（files_blob_*）与双主漂移：所有设备只读同一份单文件，电脑写出的 gist 与镜像内容完全一致。
  _safeCollectAllData() {
    const data = this._collectAllData();
    const files = Array.isArray(data._files) ? data._files : [];
    const CHUNK = 420000;       // 单个内容块最大字符数
    const chunks = {};
    data._files = files.map(f => {
      if (typeof f.content === 'string' && f.content.length > 0) {
        const n = Math.ceil(f.content.length / CHUNK);
        for (let i = 0; i < n; i++) chunks[f.id + '|' + i] = f.content.slice(i * CHUNK, (i + 1) * CHUNK);
        return Object.assign({}, f, { content: null, contentChunks: true, contentChunkCount: n, contentLength: f.content.length, cloudLimited: false });
      }
      return f;
    });
    data._fileChunks = chunks;
    // 整包（含文件内容）只落一个 data.json，彻底消除分片与双主漂移。
    const filesPayload = { 'data.json': JSON.stringify(data, null, 2) };
    const indexData = this._buildIndexPayload(data);
    const indexPayload = { 'index.json': JSON.stringify(indexData, null, 2) };
    return { data, filesPayload, indexPayload, indexData };
  },

  // 轻量索引：只含模块记录 + 文件元数据，不含任何附件正文。
  // 记录本体只有几十 KB，附件正文却占云端 99%；拆开后手机改一条记录只推索引，
  // 不必每次背 10MB 附件。data.json 保持完整不变，老设备/旧缓存依然能读，向后兼容。
  _buildIndexPayload(data) {
    const out = { version: data.version };
    Object.keys(MODULE_CONFIG).forEach(m => { if (data[m] !== undefined) out[m] = data[m]; });
    out._files = (data._files || []).map(f => {
      if (!f) return f;
      const c = Object.assign({}, f);
      delete c.content;
      return c;
    });
    out._deleted = data._deleted;
    out.lastModified = data.lastModified;
    out._indexOnly = true;
    return out;
  },

  // 附件集合指纹：只有附件增删/长度变化时才需要重传完整的 data.json
  // 附件集合指纹：本地元数据只有 contentChars，云端包只有 contentLength，必须用同一套算法，
  // 否则“本机签名”与“上次推送签名”永远对不上，或永远误判为一致（后者会让新增附件永远不传正文）。
  _filesSignature(files) {
    return (files || []).map(f => {
      if (!f) return '';
      const len = Number(f.contentLength) || Number(f.contentChars) || 0;
      const chunk = Math.max(1, Math.ceil(len / 420000));
      return f.id + ':' + len + ':' + chunk;
    }).sort().join('|');
  },

  _validateCloudFilePayload(cloudData, expectedFiles) {
    const chunks = cloudData && cloudData._fileChunks || {};
    for (const file of expectedFiles || []) {
      if (!file || !file.id || typeof file.content !== 'string' || !file.content.length) continue;
      const remote = (cloudData._files || []).find(f => f && f.id === file.id);
      if (!remote || remote.cloudLimited) return false;
      let content = typeof remote.content === 'string' && remote.content.length ? remote.content : this._joinChunks(chunks, file.id);
      if (content !== file.content) return false;
      if (remote.contentLength && remote.contentLength !== file.content.length) return false;
      if (remote.contentChunkCount) {
        for (let i = 0; i < remote.contentChunkCount; i++) {
          if (typeof chunks[file.id + '|' + i] !== 'string') return false;
        }
      }
    }
    return true;
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
      // 文件内容来源（v53 单文件方案）：
      //   1) 小文件：内容直接内联在 _files[].content；
      //   2) 大文件：分块存于 _fileChunks（id|0 / id|1 ...），按块拼接还原；
      //   3) 兜底：云端无内容（历史 cloudLimited/超大降级）时，本机有则保留。
      const localFiles = this.getFiles();
      const chunks = cloudData._fileChunks || {};
      const fileTombs = (cloudData._deleted && cloudData._deleted._files) || {};
      const protectedFiles = (cloudData._files || []).filter(cf => cf && !fileTombs[cf.id]).map(cf => {
        let content = null;
        if (typeof cf.content === 'string' && cf.content.length > 0) {
          content = cf.content;                          // 小文件内联
        } else if (!cf.cloudLimited) {
          content = this._joinChunks(chunks, cf.id);
          if (content && ((cf.contentLength && content.length !== cf.contentLength) || (cf.contentChunkCount && !Array.from({length: cf.contentChunkCount}, (_, i) => chunks[cf.id + '|' + i]).every(v => typeof v === 'string')))) content = null;      // 大文件分块拼接
        }
        if (content) {
          return Object.assign({}, cf, { content, cloudLimited: false });
        }
        // 云端无内容：本机有则保留，保证上传设备仍可预览/导出
        const lf = localFiles.find(f => f.id === cf.id);
        if (lf && lf.content) {
          return Object.assign({}, cf, { content: lf.content, cloudLimited: false });
        }
        return cf;
      });
      // 云端索引可能落后于本机（例如附件正文还在上传队列里）。本机独有、且云端没有墓碑的文件必须保留，
      // 否则一次滞后的索引就会把用户刚上传的文件从列表里抹掉（表现为“文件突然不见了”）。
      localFiles.forEach(lf => {
        if (!lf || !lf.id || fileTombs[lf.id]) return;
        if (protectedFiles.some(p => p && p.id === lf.id)) return;
        const cached = this._contentCache ? this._contentCache[lf.id] : null;
        if (typeof cached === 'string' && cached.length) protectedFiles.push(Object.assign({}, lf, { content: cached }));
        else protectedFiles.push(lf);
      });
      // 云端带来的文件内容写入 IndexedDB，元数据写入 localStorage
      this._writeFilesWithContent(protectedFiles);
    }
    // 自修复：检测“本机持有内容、但云端缺失该内容”的文件，标记 _needContentUpload 触发补推
    try {
      const cloudContentIds = new Set();
      const cfMap = cloudData._fileChunks || {};
      Object.keys(cfMap).forEach(k => { if (typeof cfMap[k] === 'string' && cfMap[k].length) cloudContentIds.add(k.split('|')[0]); });
      (cloudData._files || []).forEach(cf => {
        if (typeof cf.content === 'string' && cf.content.length) cloudContentIds.add(cf.id);
      });
      // 自修复：本机 IndexedDB/_contentCache 有正文、但云端完整包里没有该文件内容 → 标记补推。
      // 旧实现检查 f.content，但 getFiles() 返回的是元数据（正文已剥离），所以永远为 false。
      const localContentIds = Object.keys(this._contentCache || {}).filter(id => {
        const v = this._contentCache[id];
        return typeof v === 'string' && v.length > 0;
      });
      this.CLOUD._needContentUpload = localContentIds.some(id => !cloudContentIds.has(id));
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
    out._fileChunks = cloudData._fileChunks || {};   // 文件内容分块（单文件方案），供 _applyCloudData 还原
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
      // 手动同步由此函数统一发起推送；静默合并可避免 _mergeCloudData
      // 因发现本机独有数据而异步启动另一轮推送，导致下方 pushToCloud 立即撞上
      // pushInFlight 锁并把“上传正在进行”误报为失败。
      this._mergeCloudData(pullResult.data, true);
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
      return false;
    }
    try {
      localStorage.setItem(this.getKey(moduleId), JSON.stringify(data));
    } catch (e) {
      console.error('本地存储写入失败（可能存储空间已满）:', e);
      if (typeof App !== 'undefined' && App.toast) App.toast('本地存储空间不足，数据没有保存，请清理文件中心的大文件后重试', 'error');
      return false;
    }
    // 记录本地修改时间，用于与云端冲突对比（防止本地新数据被云端旧数据覆盖而丢失）
    this._setLocalModified(new Date().toISOString());
    this.schedulePush();
    return true;
  },

  add(moduleId, record) {
    const data = this.get(moduleId);
    record.id = record.id || ('id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    const nowIso = new Date().toISOString();
    record.createdAt = record.createdAt || nowIso;
    record.updatedAt = nowIso;
    data.push(record);
    return this.save(moduleId, data) ? record : null;
  },

  update(moduleId, id, updates) {
    const data = this.get(moduleId);
    const index = data.findIndex(r => r.id === id);
    if (index !== -1) {
      data[index] = { ...data[index], ...updates, id: id, updatedAt: new Date().toISOString() };
      return this.save(moduleId, data) ? data[index] : null;
    }
    return null;
  },

  delete(moduleId, id) {
    const data = this.get(moduleId);
    const filtered = data.filter(r => r.id !== id);
    if (filtered.length !== data.length && !this.save(moduleId, filtered)) return false;
    this._addTomb(moduleId, id);   // 记录删除墓碑，随同步通知其他设备删除
    return true;
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

  async loadFileContent(fileId) {
    const file = this.getFiles().find(item => item && item.id === fileId);
    if (!file || (typeof file.content === 'string' && file.content.length)) return file;
    const resp = await fetch(this.CLOUD.workerBase + this.CLOUD.gistId + '?file=' + encodeURIComponent(fileId), { cache: 'no-store' });
    if (!resp.ok) throw new Error('文件内容加载失败');
    const payload = await resp.json();
    if (!payload || typeof payload.content !== 'string') throw new Error('文件内容为空');
    this._contentCache[fileId] = payload.content;
    const metas = this.getFiles().map(item => item && item.id === fileId ? Object.assign({}, item, { content: payload.content, hasContent: true, cloudLimited: false }) : item);
    this._writeFilesWithContent(metas);
    return Object.assign({}, file, { content: payload.content, hasContent: true, cloudLimited: false });
  },

  async _hydrateFilesForPush(files) {
    // 先把本机 IndexedDB/_contentCache 里的正文挂回元数据，避免为了“补正文”去下载 10MB 云端包
    const attachLocal = (file) => {
      if (!file) return file;
      if (typeof file.content === 'string' && file.content.length) return file;
      const cached = this._contentCache ? this._contentCache[file.id] : null;
      if (typeof cached === 'string' && cached.length) return Object.assign({}, file, { content: cached, hasContent: true });
      return file;
    };
    const withLocal = (files || []).map(attachLocal);
    const missing = withLocal.filter(file => file && file.hasContent && !(typeof file.content === 'string' && file.content.length));
    if (!missing.length) { this._writeFilesWithContent(withLocal); return this.getFiles(); }
    const resp = await fetch(this.CLOUD.workerBase + this.CLOUD.gistId, { cache: 'no-store' });
    if (!resp.ok) throw new Error('云端文件批量读取失败');
    const gist = await resp.json();
    const dataFile = gist && gist.files && gist.files['data.json'];
    if (!dataFile || typeof dataFile.content !== 'string') throw new Error('云端文件快照为空');
    const cloud = JSON.parse(dataFile.content);
    const chunks = cloud._fileChunks || {};
    const byId = new Map((cloud._files || []).map(file => [file.id, file]));
    const hydrated = withLocal.map(file => {
      if (!file || !(file.hasContent && !(typeof file.content === 'string' && file.content.length))) return file;
      const remote = byId.get(file.id);
      if (!remote || remote.cloudLimited) return file;
      let content = typeof remote.content === 'string' ? remote.content : '';
      if (!content && remote.contentChunkCount) {
        for (let i = 0; i < remote.contentChunkCount; i++) content += chunks[remote.id + '|' + i] || '';
      }
      if (!content || (remote.contentLength && content.length !== remote.contentLength)) throw new Error('云端文件内容不完整: ' + (file.name || file.id));
      return Object.assign({}, file, { content, hasContent: true, cloudLimited: false });
    });
    this._writeFilesWithContent(hydrated);
    return this.getFiles();
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
    // 标记“本机确实持有附件正文”，供推送侧判断能否整包上传（手机等只有元数据的设备不受影响）
    if (content) { try { localStorage.setItem(this.PREFIX + '_has_local_content', '1'); } catch (e) {} }
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
        await fetch(this.CLOUD.workerBase + this.CLOUD.gistId, {
          method: 'PATCH',
          headers: {
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
    // 先完整验证备份结构再开始覆盖，避免坏 JSON/错误字段造成只恢复一半的数据。
    for (const moduleId of Object.keys(MODULE_CONFIG)) {
      if (!Object.prototype.hasOwnProperty.call(data, moduleId)) continue;
      const value = data[moduleId];
      if (MODULE_CONFIG[moduleId].type === 'schedule') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      } else if (!Array.isArray(value)) return false;
    }
    if (data._files !== undefined && !Array.isArray(data._files)) return false;
    for (const moduleId of Object.keys(MODULE_CONFIG)) {
      if (Object.prototype.hasOwnProperty.call(data, moduleId)) {
        if (MODULE_CONFIG[moduleId].type === 'schedule') {
          this.saveSchedule(data[moduleId]);
        } else {
          if (!this.save(moduleId, data[moduleId])) return false;
        }
      }
    }
    if (data._files) {
      if (!this._writeFilesWithContent(data._files)) return false;
      this.schedulePush();
    }
    return true;
  }
};
