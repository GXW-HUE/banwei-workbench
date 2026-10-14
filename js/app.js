/* ============================================
   班委工作台 - 主应用逻辑
   ============================================ */

const App = {
  currentModule: 'dashboard',
  searchQuery: '',
  editingId: null,
  importTargetModule: null,
  importLabelValue: null,       // 考勤模块导入标识（周次/月份）
  selectedRecords: new Set(),
  _searchTimer: null,
  // 文件中心状态
  currentFolder: null,       // 当前打开的模块文件夹，null=根目录
  fileSearchQuery: '',       // 文件中心搜索关键词
  _fileSearchTimer: null,

  // ===== 初始化 =====
  async init() {
    await Store.init();
    this.renderNav();
    this.updateDate();
    this.bindEvents();
    this.renderModule('dashboard');
    this.loadAccessInfo();
    // 更新班级名称显示
    const clsEl = document.getElementById('class-name-display');
    if (clsEl) clsEl.textContent = CLASS_INFO.fullName;
    // 每分钟更新日期
    setInterval(() => this.updateDate(), 60000);
    // 云端数据拉取完成后重新渲染（如果 init 时云端还在拉取）
    if (Store.CLOUD && Store.CLOUD.enabled) {
      setTimeout(() => this.renderModule(this.currentModule), 2000);
    }
  },

  // ===== 加载并显示局域网访问地址 =====
  loadAccessInfo() {
    fetch('/api/info')
      .then(res => res.json())
      .then(data => {
        if (data.localUrl) {
          const card = document.getElementById('access-info-card');
          const link = document.getElementById('access-link');
          if (card && link) {
            link.href = data.localUrl;
            link.textContent = data.localUrl;
            card.style.display = 'flex';
          }
        }
      })
      .catch(() => {
        // 静态文件离线打开时不显示访问信息
      });
  },

  copyAccessUrl() {
    const link = document.getElementById('access-link');
    if (!link) return;
    navigator.clipboard.writeText(link.href).then(() => {
      App.toast('链接已复制，可粘贴到微信/浏览器打开', 'success');
    }).catch(() => {
      App.toast('复制失败，请手动复制地址栏', 'warning');
    });
  },

  // ===== 渲染侧边栏导航 =====
  renderNav() {
    const nav = document.getElementById('sidebar-nav');
    let html = '';
    NAV_GROUPS.forEach(group => {
      html += '<div class="nav-group">';
      if (group.title) {
        html += `<div class="nav-group-title">${group.title}</div>`;
      }
      group.items.forEach(item => {
        const config = MODULE_CONFIG[item.id];
        const icon = config ? config.icon : item.icon;
        html += `<div class="nav-item" data-module="${item.id}" onclick="App.renderModule('${item.id}')">`;
        html += `<span class="nav-icon">${icon}</span>`;
        html += `<span>${item.label}</span>`;
        html += '</div>';
      });
      html += '</div>';
    });
    nav.innerHTML = html;
  },

  // ===== 移动端侧边栏抽屉 =====
  toggleMobileSidebar(force) {
    const sidebarEl = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const isOpen = sidebarEl.classList.contains('mobile-open');
    const next = (typeof force === 'boolean') ? force : !isOpen;
    if (next) {
      sidebarEl.classList.add('mobile-open');
      if (overlay) overlay.classList.add('show');
    } else {
      sidebarEl.classList.remove('mobile-open');
      if (overlay) overlay.classList.remove('show');
    }
  },

  // ===== 更新日期显示 =====
  updateDate() {
    const now = new Date();
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${weekdays[now.getDay()]}`;
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    document.getElementById('current-date').innerHTML = `📅 ${dateStr} &nbsp; 🕐 ${timeStr}`;
  },

  // ===== 绑定全局事件 =====
  bindEvents() {
    // 侧边栏切换：移动端抽屉 / 桌面端折叠
    const sidebarEl = document.getElementById('sidebar');
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        this.toggleMobileSidebar();
      } else {
        sidebarEl.classList.toggle('collapsed');
      }
    });

    // 移动端遮罩：点击关闭抽屉
    let overlay = document.getElementById('sidebar-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sidebar-overlay';
      overlay.className = 'sidebar-overlay';
      overlay.addEventListener('click', () => this.toggleMobileSidebar(false));
      document.body.appendChild(overlay);
    }

    // 点击任意导航项后，移动端自动关闭抽屉
    document.getElementById('sidebar-nav').addEventListener('click', (e) => {
      const navItem = e.target.closest('.nav-item');
      if (navItem && window.innerWidth <= 768) {
        this.toggleMobileSidebar(false);
      }
    });

    // 模态框关闭
    document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') this.closeModal();
    });

    // 确认框
    document.getElementById('confirm-cancel').addEventListener('click', () => this.closeConfirm());
    document.getElementById('confirm-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'confirm-overlay') this.closeConfirm();
    });

    // ===== 返回键（手机物理返回键 / 浏览器返回）=====
    // 原来 SPA 没有历史记录管理，手机上按返回键会直接退出站点。
    // 现在：进入子模块时压入一条历史记录（URL 完全不变），按返回键时优先关闭弹窗，
    // 其次回退到上一个界面；退到首页后再按返回才是真正离开站点。
    window.addEventListener('popstate', () => {
      const modalOpen = document.getElementById('modal-overlay').classList.contains('show');
      const confirmOpen = document.getElementById('confirm-overlay').classList.contains('show');
      // 1) 有确认框/弹窗打开时，返回键只关闭它，不跳转界面
      if (confirmOpen) {
        this.closeConfirm();
        try { history.pushState({ bwGuard: true }, '', location.href); } catch (e) {}
        return;
      }
      if (modalOpen) {
        this.closeModal();
        try { history.pushState({ bwGuard: true }, '', location.href); } catch (e) {}
        return;
      }
      // 2) 无弹窗时，回退到上一个模块
      const target = (history.state && history.state.bwModule) ? history.state.bwModule : 'dashboard';
      this.renderModule(target, true);
    });

    // 文件导入（根据扩展名自动判断格式，支持一次选择多个文件批量上传）
    document.getElementById('file-input').addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      const moduleId = this.importTargetModule;
      if (files.length && moduleId) {
        let ok = 0, fail = 0;
        const total = files.length;
        files.forEach((file, i) => {
          try {
            this.importTargetModule = moduleId;
            this.handleImportFile(file);
            ok++;
          } catch (err) {
            fail++;
            console.error('导入失败:', file.name, err);
          }
        });
        this.importTargetModule = null;
        if (total > 1) {
          this.toast(`批量导入完成：成功 ${ok} 个${fail ? '，失败 ' + fail + ' 个' : ''}`, fail ? 'warning' : 'success');
          // 批量上传后立即同步云端，避免退出后记录丢失
          Store.syncNow().then(res => {
            if (res.push && res.push.success) {
              this.toast('已同步到云端，所有设备可见', 'success');
            } else if (res.push && res.push.reason === 'pull_failed') {
              this.toast('云端暂时连不上，数据已保存在本机，联网后会自动同步', 'warning');
            }
          });
        } else if (fail === 0 && ok === 1) {
          this.toast('导入成功', 'success');
        }
      }
      e.target.value = '';
    });

    // ESC关闭模态框
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeModal();
        this.closeConfirm();
      }
      // Ctrl+F / Cmd+F 聚焦搜索框
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && this.currentModule !== 'dashboard' && this.currentModule !== 'files' && this.currentModule !== 'settings') {
        e.preventDefault();
        const searchInput = document.getElementById('search-input');
        if (searchInput) searchInput.focus();
      }
    });
  },

  // ===== 渲染模块 =====
  renderModule(moduleId, isPop) {
    const prevModule = this.currentModule;
    // 切换模块时清空选择
    if (this.currentModule !== moduleId) {
      this.selectedRecords.clear();
    }
    this.currentModule = moduleId;
    // 手机返回键支持：用户主动切换模块时压入一条历史记录（URL 保持不变），
    // 记录"当前所处的模块"。返回键弹出该条目后，前一条目即上一个界面。
    if (!isPop && prevModule && prevModule !== moduleId) {
      try { history.pushState({ bwModule: moduleId }, '', location.href); } catch (e) {}
    }
    this.searchQuery = '';
    // 切换到非文件中心模块时重置文件中心状态
    if (moduleId !== 'files') {
      this.currentFolder = null;
      this.fileSearchQuery = '';
    }

    // 更新导航高亮
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.module === moduleId);
    });

    const contentArea = document.getElementById('content-area');

    if (moduleId === 'dashboard') {
      document.getElementById('module-title').textContent = '工作台首页';
      document.getElementById('module-desc').textContent = '欢迎使用班委工作台';
      contentArea.innerHTML = this.renderDashboard();
      return;
    }

    if (moduleId === 'files') {
      document.getElementById('module-title').textContent = '文件中心';
      document.getElementById('module-desc').textContent = '查看和管理已导出的文件';
      contentArea.innerHTML = this.renderFileCenter();
      setTimeout(() => this._bindFileSearchEvents(), 10);
      return;
    }

    if (moduleId === 'settings') {
      document.getElementById('module-title').textContent = '设置';
      document.getElementById('module-desc').textContent = '系统设置与数据管理';
      contentArea.innerHTML = this.renderSettings();
      return;
    }

    const config = MODULE_CONFIG[moduleId];
    if (!config) return;

    document.getElementById('module-title').textContent = `${config.icon} ${config.title}`;
    document.getElementById('module-desc').textContent = config.desc;

    if (config.type === 'schedule') {
      contentArea.innerHTML = this.renderSchedulePage(moduleId);
      this.renderSchedule(moduleId);
    } else if (config.type === 'file') {
      contentArea.innerHTML = this.renderFileModule(moduleId);
    } else {
      contentArea.innerHTML = this.renderTablePage(moduleId);
      this.renderTable(moduleId);
    }
  },

  // ===== 文件型模块渲染（上传一个文件=显示一个文件） =====
  renderFileModule(moduleId) {
    const config = MODULE_CONFIG[moduleId];
    const allFiles = Store.getFiles();
    const myFiles = allFiles.filter(f => f.module === moduleId);

    let html = `
      <div class="action-bar">
        <div class="action-bar-left" style="gap:8px;align-items:center;">
          <button class="btn btn-success" onclick="App.openImportModal('${moduleId}')">📥 上传文件</button>
          <span style="font-size:13px;color:var(--text-secondary);">共 ${myFiles.length} 个文件</span>
        </div>
      </div>
      <div style="padding:10px 0;font-size:13px;color:var(--text-secondary);">
        💡 在此模块上传一个文件，就显示为一个文件，可点击"查看"在线预览，或下载/删除。
      </div>
    `;

    if (myFiles.length === 0) {
      html += `
        <div class="table-container">
          <div class="empty-state">
            <div class="empty-icon">📄</div>
            <p>暂无文件</p>
            <p style="font-size:13px;margin-top:8px;">点击上方"上传文件"上传你的 Excel / Word / PDF / PPT 文件</p>
          </div>
        </div>`;
    } else {
      html += '<div class="file-list">';
      myFiles.forEach(file => {
        html += this._renderFileItem(file, false);
      });
      html += '</div>';
    }
    return html;
  },

  // ===== 渲染仪表盘 =====
  renderDashboard() {
    const stats = Store.getStats();
    const totalStudents = stats.students || 0;
    const totalTalks = stats.talk || 0;
    const totalMeetings = stats.meeting || 0;
    const totalActivities = stats.activity || 0;
    const totalDuties = stats.duty || 0;
    const totalWeekly = stats.weekly || 0;
    const totalMonthly = stats.monthly || 0;
    const totalFriendship = stats.friendship || 0;
    const totalLeaders = stats.leader || 0;
    const scheduleCount = stats.schedule || 0;

    let html = `
      <div class="dashboard-hero">
        <h2>👋 欢迎使用班委工作台</h2>
        <p>高效管理班级事务，让工作更加有序、规范</p>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon" style="background:#ecfdf5;color:#10b981;">👥</div>
          <div class="stat-info">
            <h3>${totalStudents}</h3>
            <p>在校学生</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#eff6ff;color:#3b82f6;">📅</div>
          <div class="stat-info">
            <h3>${scheduleCount}</h3>
            <p>课程安排</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#fffbeb;color:#f59e0b;">🧹</div>
          <div class="stat-info">
            <h3>${totalDuties}</h3>
            <p>值日记录</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#eef2ff;color:#6366f1;">📈</div>
          <div class="stat-info">
            <h3>${totalWeekly}</h3>
            <p>周分析报告</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#fef2f2;color:#ef4444;">🔍</div>
          <div class="stat-info">
            <h3>${totalMonthly}</h3>
            <p>月排查记录</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#f5f3ff;color:#8b5cf6;">💬</div>
          <div class="stat-info">
            <h3>${totalTalks}</h3>
            <p>谈心谈话</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#ecfeff;color:#06b6d4;">🤝</div>
          <div class="stat-info">
            <h3>${totalFriendship}</h3>
            <p>四进两联一交友</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#fdf2f8;color:#ec4899;">🎤</div>
          <div class="stat-info">
            <h3>${totalMeetings}</h3>
            <p>主题班会</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#f0fdfa;color:#14b8a6;">⚽</div>
          <div class="stat-info">
            <h3>${totalActivities}</h3>
            <p>文体活动</p>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon" style="background:#fff7ed;color:#f97316;">🎓</div>
          <div class="stat-info">
            <h3>${totalLeaders}</h3>
            <p>干部培养记录</p>
          </div>
        </div>
      </div>

      <div class="access-info-card" id="access-info-card" style="display:none;">
        <div class="access-info-left">
          <div class="access-icon">📱</div>
          <div>
            <div class="access-title">手机 / 微信访问</div>
            <div class="access-desc">在同一 WiFi 下，用手机或微信访问下方地址即可使用</div>
          </div>
        </div>
        <div class="access-info-right">
          <a id="access-link" href="#" target="_blank" class="access-url"></a>
          <button class="btn btn-sm btn-secondary" onclick="App.copyAccessUrl()">复制链接</button>
        </div>
      </div>

      <div class="action-bar" style="margin-top:8px;">
        <h3 style="font-size:18px;font-weight:600;">快捷入口 / 一键导出</h3>
        <div class="action-bar-right" style="gap:8px;">
          <button class="btn btn-success" onclick="App.openExportModal('all')">📤 一键导出全部</button>
          <button class="btn btn-secondary" onclick="App.openImportModal('all')" title="自动识别文件类型：Excel/Word/PDF/PPT/JSON">📥 导入文件</button>
        </div>
      </div>

      <div class="module-grid">
    `;

    Object.keys(MODULE_CONFIG).forEach(moduleId => {
      const config = MODULE_CONFIG[moduleId];
      // 文件型模块（学生请假 / 学生缺勤 / 周末去向）的数据存放在"文件列表"中，
      // 不能再用 Store.get(moduleId).length 统计，否则上传了文件也永远显示 0
      const count = stats[moduleId] || 0;
      html += `
        <div class="module-card" onclick="App.renderModule('${moduleId}')">
          <div class="module-card-header">
            <div class="module-card-icon" style="background:${config.bg};color:${config.color};">${config.icon}</div>
            <div class="module-card-title">${config.title}</div>
          </div>
          <div class="module-card-desc">${config.desc}</div>
          <div class="module-card-footer">
            <span>共 <span class="record-count">${count}</span> ${config.type === 'file' ? '个文件' : '条记录'}</span>
            <span style="color:${config.color};font-weight:500;">查看 →</span>
          </div>
        </div>
      `;
    });

    html += '</div>';
    return html;
  },

  // ===== 渲染表格页面框架 =====
  renderTablePage(moduleId) {
    const config = MODULE_CONFIG[moduleId];
    return `
      <div class="action-bar">
        <div class="action-bar-left">
          <button class="btn btn-primary" onclick="App.openAddModal('${moduleId}')">➕ 新增记录</button>
          <div class="search-box">
            <span class="search-icon">🔍</span>
            <input type="text" id="search-input" placeholder="搜索..." oninput="App.handleSearch('${moduleId}', this.value)">
          </div>
        </div>
        <div class="action-bar-right" style="gap:8px;">
          <button class="btn btn-success" onclick="App.handleModuleExport('${moduleId}')">📤 导出原文件<span id="selection-badge-${moduleId}" class="selection-badge hidden">0</span></button>
          <button class="btn btn-secondary" onclick="App.openImportModal('${moduleId}')" title="Excel 解析导入；Word(docx) 在周分析/月排查/班会/活动/谈心/交友模块会自动解析为记录；其他格式存入文件中心">📥 导入文件</button>
        </div>
      </div>
      <div class="table-container">
        <div class="table-wrapper">
          <table class="data-table" id="data-table-${moduleId}">
            <thead id="table-head-${moduleId}"></thead>
            <tbody id="table-body-${moduleId}"></tbody>
          </table>
        </div>
      </div>
    `;
  },

  // 从"机电一体化 2503 谢鸿宇"这类混合格式中提取人名（用于四进两联一交友等模块的列表显示）
  _extractPersonName(text) {
    if (!text) return text;
    const t = String(text).trim();
    // 专业(可能带英文/中文) + 班级数字 + 姓名，取最后2-4个汉字
    let m = t.match(/[\u4e00-\u9fa5a-zA-Z]+\s*\d+\s*班?\s*([\u4e00-\u9fa5]{2,4})(?:\s|$)/);
    if (m) return m[1];
    // 兜底：末尾连续2-4个汉字
    m = t.match(/([\u4e00-\u9fa5]{2,4})$/);
    if (m) return m[1];
    return t;
  },

  // ===== 渲染表���数据 =====
  renderTable(moduleId) {
    const config = MODULE_CONFIG[moduleId];
    const data = Store.get(moduleId);
    const allFields = config.fields;
    // 表格显示字段：如果配置了 tableFields 则使用，否则使用全部 fields
    const displayFields = config.tableFields
      ? config.tableFields.map(name => allFields.find(f => f.name === name)).filter(Boolean)
      : allFields;

    // 过滤搜索（仍然搜索全部字段）
    let filtered = data;
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      filtered = data.filter(record => {
        return allFields.some(f => {
          const val = record[f.name];
          return val !== undefined && String(val).toLowerCase().includes(q);
        });
      });
    }

    // 渲染表头
    const headHtml = `<tr><th style="width:40px;min-width:40px;max-width:40px;text-align:center;"><input type="checkbox" id="select-all-${moduleId}" onclick="App.toggleSelectAll('${moduleId}', this.checked)"></th>` + displayFields.map(f => `<th style="min-width:${f.width || 100}px;max-width:${f.width || 280}px">${f.label}</th>`).join('') + '<th style="width:120px;text-align:center;">操作</th></tr>';
    document.getElementById(`table-head-${moduleId}`).innerHTML = headHtml;

    // 渲染表体
    const tbody = document.getElementById(`table-body-${moduleId}`);
    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${displayFields.length + 2}" class="empty-state"><div class="empty-icon">📭</div><p>${this.searchQuery ? '未找到匹配的记录' : '暂无数据，点击"新增记录"添加'}</p></td></tr>`;
      return;
    }

    let bodyHtml = '';
    filtered.forEach(record => {
      const checked = this.selectedRecords.has(record.id) ? 'checked' : '';
      bodyHtml += `<tr class="${checked ? 'selected-row' : ''}">`;
      bodyHtml += `<td style="text-align:center;"><input type="checkbox" class="row-checkbox" data-id="${record.id}" ${checked} onclick="App.toggleSelectRow('${moduleId}', '${record.id}', this.checked)"></td>`;
      displayFields.forEach(f => {
        let val = record[f.name];
        // 四进两联一交友：被谈话人字段清洗，只显示人名（兼容"机电一体化 2503 谢鸿宇"）
        if (moduleId === 'friendship' && f.name === 'participants' && val) {
          val = this._extractPersonName(val);
        }
        if (val === undefined || val === null || val === '') {
          val = '<span style="color:#cbd5e1;">—</span>';
        } else if (f.type === 'select') {
          // 特殊状态值着色
          if (['已完成', '已整改', '已开展', '良好'].includes(val)) {
            val = `<span class="tag tag-success">${val}</span>`;
          } else if (['进行中', '整改中', '计划中', '一般'].includes(val)) {
            val = `<span class="tag tag-warning">${val}</span>`;
          } else if (['未完成', '待整改', '需干预'].includes(val)) {
            val = `<span class="tag tag-danger">${val}</span>`;
          } else if (['需关注'].includes(val)) {
            val = `<span class="tag tag-info">${val}</span>`;
          } else {
            val = `<span class="tag tag-primary">${val}</span>`;
          }
        } else if (f.type === 'textarea') {
          const str = String(val);
          val = str.length > 24 ? `<span title="${this.escapeHtml(str)}">${this.escapeHtml(str.slice(0, 24))}...</span>` : this.escapeHtml(str);
        } else {
          val = this.escapeHtml(String(val));
        }
        bodyHtml += `<td>${val}</td>`;
      });
      bodyHtml += `<td><div class="table-actions">
        <button class="btn-icon eye" title="查看记录详情" onclick="App.viewRecordDetail('${moduleId}', '${record.id}')">👁️</button>
        <button class="btn-icon" title="编辑" onclick="App.openEditModal('${moduleId}', '${record.id}')">✏️</button>
        <button class="btn-icon danger" title="删除" onclick="App.deleteRecord('${moduleId}', '${record.id}')">🗑️</button>
      </div></td>`;
      bodyHtml += '</tr>';
    });
    tbody.innerHTML = bodyHtml;

    // 更新全选复选框状态（全选/部分选中/未选）
    this._updateSelectAllState(moduleId, filtered);
  },

  _updateSelectAllState(moduleId, filtered) {
    const checkbox = document.getElementById(`select-all-${moduleId}`);
    if (!checkbox || filtered.length === 0) return;
    const selectedCount = filtered.filter(r => this.selectedRecords.has(r.id)).length;
    checkbox.checked = selectedCount === filtered.length;
    checkbox.indeterminate = selectedCount > 0 && selectedCount < filtered.length;
  },

  // ===== 搜索处理 =====
  handleSearch(moduleId, value) {
    this.searchQuery = value;
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this.renderTable(moduleId);
    }, 250);
  },

  // ===== 表格复选框 =====
  toggleSelectAll(moduleId, checked) {
    const data = Store.get(moduleId);
    const filtered = this.searchQuery ? data.filter(record => {
      return MODULE_CONFIG[moduleId].fields.some(f => {
        const val = record[f.name];
        return val !== undefined && String(val).toLowerCase().includes(this.searchQuery.toLowerCase());
      });
    }) : data;

    filtered.forEach(r => {
      if (checked) this.selectedRecords.add(r.id);
      else this.selectedRecords.delete(r.id);
    });
    clearTimeout(this._searchTimer);
    this.renderTable(moduleId);
    this._updateSelectionBadge(moduleId);
  },

  toggleSelectRow(moduleId, recordId, checked) {
    if (checked) this.selectedRecords.add(recordId);
    else this.selectedRecords.delete(recordId);
    clearTimeout(this._searchTimer);
    this.renderTable(moduleId);
    this._updateSelectionBadge(moduleId);
  },

  _updateSelectionBadge(moduleId) {
    const badge = document.getElementById(`selection-badge-${moduleId}`);
    if (!badge) return;
    const selectedIds = this.getSelectedRecordIds(moduleId);
    if (selectedIds.length > 0) {
      badge.textContent = selectedIds.length;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  },

  getSelectedRecordIds(moduleId) {
    const data = Store.get(moduleId);
    const ids = [];
    data.forEach(r => { if (this.selectedRecords.has(r.id)) ids.push(r.id); });
    return ids;
  },

  clearSelection() {
    this.selectedRecords.clear();
    if (this.currentModule !== 'dashboard' && this.currentModule !== 'files' && this.currentModule !== 'settings') {
      this._updateSelectionBadge(this.currentModule);
    }
  },

  // ===== 本地后端检测（公网版也能用 WPS 打开的秘诀）=====
  // 缓存本地后端可用状态，避免每次点击都 ping
  _localBackendAvail: false,
  _localBackendChecked: false,
  _localBackendUrl: 'http://localhost:8080',

  async _checkLocalBackend() {
    // 已检测过且可用，直接用缓存结果
    if (this._localBackendChecked && this._localBackendAvail) return true;
    // 30 秒内不重复 ping
    if (this._localBackendChecked && this._localBackendLastCheck && (Date.now() - this._localBackendLastCheck < 30000)) {
      return this._localBackendAvail;
    }
    this._localBackendLastCheck = Date.now();

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(this._localBackendUrl + '/api/ping', { signal: ctrl.signal });
      clearTimeout(timeout);
      if (res.ok) {
        this._localBackendAvail = true;
        this._localBackendChecked = true;
        return true;
      }
    } catch (e) { /* 连不上，继续用 false */ }
    this._localBackendAvail = false;
    this._localBackendChecked = true;
    return false;
  },

  // ===== 查看单条记录（小眼睛）=====
  // 表格记录的眼睛按钮：查看记录完整详情（若关联原始文件则同时提供在线预览入口）
  viewRecordDetail(moduleId, recordId) {
    const config = MODULE_CONFIG[moduleId];
    const record = Store.get(moduleId).find(r => r.id === recordId);
    if (!record) return;

    // 有原始文件时：详情 + 在线预览入口
    let sourceFile = record.sourceFile;
    if (!sourceFile) {
      const moduleFiles = Store.getFiles().filter(f => f.module === moduleId && f.content);
      if (moduleFiles.length > 0) sourceFile = { fileId: moduleFiles[0].id };
    }

    const rows = config.fields.map(f => {
      let val = record[f.name];
      if (val === undefined || val === null || val === '') val = '<span style="color:#cbd5e1;">—</span>';
      else val = this.escapeHtml(String(val));
      return `<tr><td style="padding:8px 12px;color:var(--text-secondary);white-space:nowrap;font-size:13px;border-bottom:1px solid var(--border-light,#eef1f5);">${f.label}</td><td style="padding:8px 12px;font-size:13px;border-bottom:1px solid var(--border-light,#eef1f5);word-break:break-all;">${val}</td></tr>`;
    }).join('');

    let sourceHtml = '';
    if (sourceFile) {
      const sourceName = (typeof sourceFile === 'string')
        ? sourceFile.split('/').pop()
        : (sourceFile && sourceFile.name) || '原始文件';
      sourceHtml = `
        <div class="format-card source-file-card" onclick="App.openRecordSourceFile('${moduleId}', '${recordId}')" style="border:2px solid #10b981;cursor:pointer;margin-bottom:14px;">
          <div class="format-icon" style="background:#10b98115;color:#10b981;">📄</div>
          <div class="format-info">
            <div class="format-title" style="color:#10b981;">📂 在线预览原始文件</div>
            <div class="format-desc">无需下载，联网即可查看 ${this.escapeHtml(sourceName)}</div>
          </div>
        </div>
        <div class="format-hint" style="margin-bottom:12px;">💡 也可点击下方字段查看记录内容</div>
      `;
    }

    document.getElementById('modal-title').textContent = `👁️ 记录详情 - ${config.title}`;
    document.getElementById('modal-body').innerHTML = `
      ${sourceHtml}
      <div style="border:1px solid var(--border-light,#eef1f5);border-radius:10px;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
      </div>
    `;
    document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="App.closeModal()">关闭</button>
    `;
    this.openModal();
  },

  // 点击眼睛后直接在应用内在线预览原始文件（Office Online / PDF / 图片），
  // 不再触发浏览器下载，也不再依赖本地后端。
  async openRecordSourceFile(moduleId, recordId) {
    const record = Store.get(moduleId).find(r => r.id === recordId);
    if (!record) return;

    // 兜底：记录没有 sourceFile 时，从文件中心查找同模块的最新文件
    let sourceFile = record.sourceFile;
    if (!sourceFile) {
      const moduleFiles = Store.getFiles().filter(f => f.module === moduleId && f.content);
      if (moduleFiles.length > 0) {
        sourceFile = { fileId: moduleFiles[0].id };
      }
    }

    if (!sourceFile) {
      App.toast('该记录没有关联原始文件', 'error');
      return;
    }

    let fileToOpen;
    if (typeof sourceFile === 'string') {
      fileToOpen = { assetUrl: sourceFile };
    } else if (sourceFile.fileId) {
      const files = Store.getFiles();
      const fileInfo = files.find(f => f.id === sourceFile.fileId);
      if (!fileInfo) {
        App.toast('找不到源文件，请重新导入', 'error');
        return;
      }
      fileToOpen = fileInfo;
    }

    if (!fileToOpen) {
      App.toast('找不到源文件路径', 'error');
      return;
    }

    // 在线预览：Word/Excel/PPT/PDF/图片 直接在应用内打开，无需下载
    if (fileToOpen.assetUrl) {
      const fileName = fileToOpen.name || decodeURIComponent(fileToOpen.assetUrl.split('/').pop());
      Exporter.previewDocument(fileToOpen.assetUrl, fileName);
    } else if (fileToOpen.content) {
      // base64 附件：纯前端在线预览（docx / xlsx / pdf / 图片）
      Exporter.previewBase64Content(fileToOpen.content, fileToOpen.name || '附件预览');
    } else {
      Exporter.openSourceFile(record.sourceFile);
    }
  },

  // 旧弹窗入口保留，供没有小眼睛按钮的地方使用
  openViewRecordModal(moduleId, recordId) {
    const config = MODULE_CONFIG[moduleId];
    const record = Store.get(moduleId).find(r => r.id === recordId);
    if (!record) return;

    // 兜底：没有 sourceFile 时从文件中心查找同模块最新文件
    let sourceFile = record.sourceFile;
    if (!sourceFile) {
      const moduleFiles = Store.getFiles().filter(f => f.module === moduleId && f.content);
      if (moduleFiles.length > 0) sourceFile = { fileId: moduleFiles[0].id };
    }

    // 优先展示"打开原始文件"
    if (sourceFile) {
      const sourceName = (typeof sourceFile === 'string')
        ? sourceFile.split('/').pop()
        : (sourceFile && sourceFile.name) || '原始文件';
      const sourceHtml = `
        <div class="format-card source-file-card" onclick="App.openRecordSourceFile('${moduleId}', '${recordId}')" style="border:2px solid #10b981;cursor:pointer;">
          <div class="format-icon" style="background:#10b98115;color:#10b981;">📄</div>
          <div class="format-info">
            <div class="format-title" style="color:#10b981;">📂 预览原始文件</div>
            <div class="format-desc">在线预览 ${this.escapeHtml(sourceName)}，无需下载</div>
          </div>
        </div>
      `;
      document.getElementById('modal-title').textContent = `👁️ 查看记录 - ${config.title}`;
      document.getElementById('modal-body').innerHTML = `
        <div class="format-grid">${sourceHtml}</div>
        <div class="format-hint">💡 点击上方卡片即可在线预览原始文件，任何电脑联网都能直接查看，无需下载。</div>
      `;
      document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-secondary" onclick="App.closeModal()">关闭</button>
      `;
      this.openModal();
      return;
    }

    // 没有原始文件时：提示无法查看
    document.getElementById('modal-title').textContent = `👁️ 查看记录 - ${config.title}`;
    document.getElementById('modal-body').innerHTML = `
      <div style="padding:24px;text-align:center;color:var(--text-secondary);">
        <div style="font-size:48px;margin-bottom:12px;">📄</div>
        <div style="font-size:15px;margin-bottom:8px;color:var(--text-primary);">该记录没有关联原始文件</div>
        <div style="font-size:13px;">此记录可能是手动添加的，或原始文件已被清理。</div>
      </div>
    `;
    document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="App.closeModal()">关闭</button>
    `;
    this.openModal();
  },

  viewSourceFile(moduleId, recordId) {
    this.closeModal();
    const record = Store.get(moduleId).find(r => r.id === recordId);
    if (!record || !record.sourceFile) {
      App.toast('该记录没有原始文件', 'error');
      return;
    }
    this.openRecordSourceFile(moduleId, recordId);
  },

  // ===== 渲染课表页面 =====
  renderSchedulePage(moduleId) {
    return `
      <div class="action-bar">
        <div class="action-bar-left">
          <p style="color:var(--text-secondary);font-size:13px;">💡 点击空白单元格添加课程，点击已有课程编辑或删除</p>
        </div>
        <div class="action-bar-right" style="gap:8px;">
          <button class="btn btn-success" onclick="App.openExportModal('${moduleId}')">📤 导出</button>
          <button class="btn btn-secondary" onclick="App.openImportModal('${moduleId}')" title="支持导入 Excel(.xlsx/.csv) 或课表截图(图片)，自动识别后确认导入">📥 导入课表</button>
        </div>
      </div>
      <div class="schedule-grid">
        <table class="schedule-table" id="schedule-table-${moduleId}"></table>
      </div>
    `;
  },

  // ===== 渲染课表 =====
  renderSchedule(moduleId) {
    const config = MODULE_CONFIG[moduleId];
    const scheduleData = Store.getSchedule();
    const days = config.days;
    const periods = config.periods;

    let html = '<thead><tr>';
    html += '<th style="width:100px;">时间段</th>';
    days.forEach(d => { html += `<th>${d}</th>`; });
    html += '</tr></thead><tbody>';

    periods.forEach((period, pi) => {
      html += `<tr><td class="period-cell">${period.name}<br><span style="font-size:11px;font-weight:normal;color:var(--text-light);">${period.time}</span></td>`;
      days.forEach((day, di) => {
        const cell = scheduleData[`${pi}-${di}`];
        const cellKey = `${pi}-${di}`;
        // 如果是大课的第二小节（上一节是同一门课），跳过（由第一小节跨行显示）
        const prevCell = scheduleData[`${pi - 1}-${di}`];
        if (cell && prevCell && this._sameCourse(cell, prevCell)) {
          return;
        }
        if (cell) {
          // 判断是否是"大课第一小节"（下一节是同一门课）
          const nextCell = scheduleData[`${pi + 1}-${di}`];
          const isBigFirst = nextCell && this._sameCourse(cell, nextCell);
          html += `<td class="schedule-cell has-class${isBigFirst ? ' big-class' : ''}" ${isBigFirst ? 'rowspan="2"' : ''} onclick="App.openScheduleCellModal('${moduleId}', ${pi}, ${di})">
            <div class="subject">${this.escapeHtml(cell.subject)}</div>
            <div class="teacher">${this.escapeHtml(cell.teacher)}</div>
            <div class="location">${this.escapeHtml(cell.location)}</div>
            ${isBigFirst ? '<div class="big-tag">大课 · 两节连上</div>' : ''}
          </td>`;
        } else {
          html += `<td class="schedule-cell empty" onclick="App.openScheduleCellModal('${moduleId}', ${pi}, ${di})">+</td>`;
        }
      });
      html += '</tr>';
    });

    html += '</tbody>';
    document.getElementById(`schedule-table-${moduleId}`).innerHTML = html;
  },

  // ===== 打开新增记录模态框 =====
  openAddModal(moduleId) {
    const config = MODULE_CONFIG[moduleId];
    this.editingId = null;

    let formHtml = '<div class="form-row">';
    let fieldCount = 0;

    config.fields.forEach(f => {
      if (fieldCount > 0 && fieldCount % 2 === 0) {
        formHtml += '</div><div class="form-row">';
      }
      const required = f.required ? '<span class="required">*</span>' : '';
      formHtml += `<div class="form-group"><label>${f.label} ${required}</label>`;
      if (f.type === 'textarea') {
        formHtml += `<textarea name="${f.name}" placeholder="请输入${f.label}"></textarea>`;
      } else if (f.type === 'select') {
        formHtml += `<select name="${f.name}"><option value="">请选择</option>`;
        f.options.forEach(opt => {
          formHtml += `<option value="${opt}">${opt}</option>`;
        });
        formHtml += '</select>';
      } else if (f.type === 'date') {
        formHtml += `<input type="date" name="${f.name}" placeholder="请输入${f.label}">`;
      } else if (f.type === 'number') {
        formHtml += `<input type="number" name="${f.name}" placeholder="请输入${f.label}">`;
      } else {
        formHtml += `<input type="text" name="${f.name}" placeholder="请输入${f.label}">`;
      }
      formHtml += '</div>';
      fieldCount++;
    });

    formHtml += '</div>';

    document.getElementById('modal-title').textContent = `➕ 新增${config.title}`;
    document.getElementById('modal-body').innerHTML = formHtml;
    document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="App.closeModal()">取消</button>
      <button class="btn btn-primary" onclick="App.saveRecord('${moduleId}')">保存</button>
    `;
    this.openModal();
  },

  // ===== 打开编辑记录模态框 =====
  openEditModal(moduleId, recordId) {
    const config = MODULE_CONFIG[moduleId];
    const data = Store.get(moduleId);
    const record = data.find(r => r.id === recordId);
    if (!record) return;

    this.editingId = recordId;

    let formHtml = '<div class="form-row">';
    let fieldCount = 0;

    config.fields.forEach(f => {
      if (fieldCount > 0 && fieldCount % 2 === 0) {
        formHtml += '</div><div class="form-row">';
      }
      const required = f.required ? '<span class="required">*</span>' : '';
      const val = record[f.name] !== undefined ? this.escapeHtml(String(record[f.name])) : '';
      formHtml += `<div class="form-group"><label>${f.label} ${required}</label>`;
      if (f.type === 'textarea') {
        formHtml += `<textarea name="${f.name}" placeholder="请输入${f.label}">${val}</textarea>`;
      } else if (f.type === 'select') {
        formHtml += `<select name="${f.name}"><option value="">请选择</option>`;
        f.options.forEach(opt => {
          const selected = record[f.name] === opt ? 'selected' : '';
          formHtml += `<option value="${opt}" ${selected}>${opt}</option>`;
        });
        formHtml += '</select>';
      } else if (f.type === 'date') {
        formHtml += `<input type="date" name="${f.name}" value="${val}">`;
      } else if (f.type === 'number') {
        formHtml += `<input type="number" name="${f.name}" value="${val}" placeholder="请输入${f.label}">`;
      } else {
        formHtml += `<input type="text" name="${f.name}" value="${val}" placeholder="请输入${f.label}">`;
      }
      formHtml += '</div>';
      fieldCount++;
    });

    formHtml += '</div>';

    document.getElementById('modal-title').textContent = `✏️ 编辑${config.title}`;
    document.getElementById('modal-body').innerHTML = formHtml;
    document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="App.closeModal()">取消</button>
      <button class="btn btn-primary" onclick="App.saveRecord('${moduleId}')">保存</button>
    `;
    this.openModal();
  },

  // ===== 保存记录 =====
  saveRecord(moduleId) {
    const config = MODULE_CONFIG[moduleId];
    const modalBody = document.getElementById('modal-body');
    const record = {};

    let hasError = false;
    config.fields.forEach(f => {
      const el = modalBody.querySelector(`[name="${f.name}"]`);
      if (el) {
        record[f.name] = el.value.trim();
        if (f.required && !record[f.name]) {
          el.style.borderColor = 'var(--danger)';
          hasError = true;
        } else {
          el.style.borderColor = '';
        }
        if (f.type === 'number' && record[f.name]) {
          record[f.name] = parseInt(record[f.name]) || record[f.name];
        }
      }
    });

    if (hasError) {
      this.toast('请填写必填字段', 'warning');
      return;
    }

    if (this.editingId) {
      Store.update(moduleId, this.editingId, record);
      this.toast('记录已更新', 'success');
    } else {
      Store.add(moduleId, record);
      this.toast('记录已添加', 'success');
    }

    this.closeModal();
    this.renderTable(moduleId);
  },

  // ===== 删除记录 =====
  deleteRecord(moduleId, recordId) {
    this.showConfirm('确认删除', '确定要删除这条记录吗？关联的源文件也会一并删除。', () => {
      // 1. 如果记录有关联文件，同时删除文件中心的文件
      const record = (Store.get(moduleId) || []).find(r => r.id === recordId);
      if (record && record.sourceFile && typeof record.sourceFile === 'object' && record.sourceFile.fileId) {
        Store.deleteFile(record.sourceFile.fileId);
      }
      // 2. 删除记录
      Store.delete(moduleId, recordId);
      this.renderTable(moduleId);
      this.toast('记录及关联文件已删除', 'success');
    });
  },

  // ===== 课表单元格编辑 =====
  openScheduleCellModal(moduleId, periodIndex, dayIndex) {
    const config = MODULE_CONFIG[moduleId];
    const cell = Store.getScheduleCell(periodIndex, dayIndex);
    const periodName = config.periods[periodIndex].name;
    const dayName = config.days[dayIndex];
    const canBig = periodIndex < config.periods.length - 1;
    const nextCell = canBig ? Store.getScheduleCell(periodIndex + 1, dayIndex) : null;
    const isBig = canBig && cell && nextCell && this._sameCourse(cell, nextCell);

    const formHtml = `
      <div class="form-group">
        <label>时间段</label>
        <input type="text" value="${periodName} ${dayName} (${config.periods[periodIndex].time})" disabled>
      </div>
      <div class="form-group">
        <label>课程名称 <span class="required">*</span></label>
        <input type="text" name="subject" value="${cell ? this.escapeHtml(cell.subject) : ''}" placeholder="如：高等数学" id="cell-subject">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>任课教师</label>
          <input type="text" name="teacher" value="${cell ? this.escapeHtml(cell.teacher) : ''}" placeholder="如：张教授" id="cell-teacher">
        </div>
        <div class="form-group">
          <label>教室</label>
          <input type="text" name="location" value="${cell ? this.escapeHtml(cell.location) : ''}" placeholder="如：A301" id="cell-location">
        </div>
      </div>
      ${canBig ? `
      <div class="form-group" style="margin-top:12px;padding:10px 12px;background:var(--bg-light,#f8fafc);border-radius:8px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:500;">
          <input type="checkbox" id="cell-big-class" ${isBig ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;">
          <span>📚 这是大课（连上两节：${config.periods[periodIndex].name} + ${config.periods[periodIndex + 1].name}）</span>
        </label>
        <p style="margin:6px 0 0 24px;font-size:12px;color:var(--text-secondary,#6b7280);">勾选后保存会自动把下一节也填上同一门课</p>
      </div>` : ''}
    `;

    document.getElementById('modal-title').textContent = `📅 编辑课程 - ${periodName} ${dayName}`;
    document.getElementById('modal-body').innerHTML = formHtml;
    document.getElementById('modal-footer').innerHTML = `
      ${cell ? `<button class="btn btn-danger" style="margin-right:auto;" onclick="App.deleteScheduleCell('${moduleId}', ${periodIndex}, ${dayIndex})">🗑️ 删除课程</button>` : ''}
      <button class="btn btn-secondary" onclick="App.closeModal()">取消</button>
      <button class="btn btn-primary" onclick="App.saveScheduleCell('${moduleId}', ${periodIndex}, ${dayIndex})">保存</button>
    `;
    this.openModal();
  },

  // 判断两节课是否为同一门课（课程名+教师+教室都相同）
  _sameCourse(a, b) {
    return !!(a && b && a.subject === b.subject && a.teacher === b.teacher && a.location === b.location);
  },

  saveScheduleCell(moduleId, periodIndex, dayIndex) {
    const subject = document.getElementById('cell-subject').value.trim();
    const teacher = document.getElementById('cell-teacher').value.trim();
    const location = document.getElementById('cell-location').value.trim();

    if (!subject) {
      this.toast('请输入课程名称', 'warning');
      return;
    }

    const config = MODULE_CONFIG[moduleId];
    const bigCheckbox = document.getElementById('cell-big-class');
    const isBig = !!(bigCheckbox && bigCheckbox.checked);

    Store.setScheduleCell(periodIndex, dayIndex, { subject, teacher, location });

    if (isBig && periodIndex < config.periods.length - 1) {
      // 大课：自动填下一节
      Store.setScheduleCell(periodIndex + 1, dayIndex, { subject, teacher, location });
    } else if (periodIndex < config.periods.length - 1) {
      // 非大课：如果下一节是同一门课（原来是大课拆开），同步清除
      const nextCell = Store.getScheduleCell(periodIndex + 1, dayIndex);
      if (nextCell && this._sameCourse(nextCell, { subject, teacher, location })) {
        Store.setScheduleCell(periodIndex + 1, dayIndex, null);
      }
    }

    this.closeModal();
    this.renderSchedule(moduleId);
    this.toast(isBig ? '大课已保存，两节连上' : '课程已保存', 'success');
  },

  deleteScheduleCell(moduleId, periodIndex, dayIndex) {
    this.showConfirm('确认删除', '确定要删除这节课吗？如果这是大课，相连的另一节也会一并删除。', () => {
      const config = MODULE_CONFIG[moduleId];
      const cell = Store.getScheduleCell(periodIndex, dayIndex);
      Store.setScheduleCell(periodIndex, dayIndex, null);
      // 如果当前是大课的第一小节，联动删除第二小节
      if (periodIndex < config.periods.length - 1) {
        const nextCell = Store.getScheduleCell(periodIndex + 1, dayIndex);
        if (cell && nextCell && this._sameCourse(nextCell, cell)) {
          Store.setScheduleCell(periodIndex + 1, dayIndex, null);
        }
      }
      // 如果当前是大课的第二小节，联动删除第一小节
      if (periodIndex > 0) {
        const prevCell = Store.getScheduleCell(periodIndex - 1, dayIndex);
        if (cell && prevCell && this._sameCourse(prevCell, cell)) {
          Store.setScheduleCell(periodIndex - 1, dayIndex, null);
        }
      }
      this.closeModal();
      this.renderSchedule(moduleId);
      this.toast('课程已删除', 'success');
    });
  },

  // ===== 统一导出/导入入口 =====
  openExportModal(moduleId) {
    const isAll = moduleId === 'all';
    const title = isAll ? '导出全部数据' : `导出${MODULE_CONFIG[moduleId].title}`;
    const selectedIds = isAll ? [] : this.getSelectedRecordIds(moduleId);
    const selectedCount = selectedIds.length;

    const cards = FILE_FORMATS.map(f => `
      <div class="format-card" onclick="App.doExport('${moduleId}', '${f.id}')">
        <div class="format-icon" style="background:${f.color}15;color:${f.color};">${f.icon}</div>
        <div class="format-info">
          <div class="format-title">${f.label}</div>
          <div class="format-desc">导出为 ${f.ext} 格式</div>
        </div>
      </div>
    `).join('');

    const hint = isAll
      ? '💡 选择格式后自动下载全部模块数据，下载完成可用 WPS / Microsoft Office 打开编辑。'
      : (selectedCount > 0
        ? `💡 已选中 <strong>${selectedCount}</strong> 条记录，选择格式后将导出这 ${selectedCount} 条记录；未选中任何记录时导出全部。`
        : '💡 未选中任何记录，选择格式后导出当前模块全部数据。');

    document.getElementById('modal-title').textContent = `📤 ${title}`;
    document.getElementById('modal-body').innerHTML = `
      <div class="format-grid">${cards}</div>
      <div class="format-hint">${hint}</div>
    `;
    document.getElementById('modal-footer').innerHTML = `
      ${!isAll && selectedCount > 0 ? `<button class="btn btn-secondary" style="margin-right:auto;" onclick="App.clearSelection();App.renderTable('${moduleId}');App.openExportModal('${moduleId}')">清空选择</button>` : ''}
      <button class="btn btn-secondary" onclick="App.closeModal()">取消</button>
    `;
    this.openModal();
  },

  doExport(moduleId, format) {
    this.closeModal();
    if (moduleId === 'all') {
      Exporter.exportAllFiles(format);
    } else {
      const selectedIds = this.getSelectedRecordIds(moduleId);
      const options = selectedIds.length > 0 ? { recordIds: selectedIds } : {};
      Exporter.exportFile(moduleId, format, options);
    }
  },

  // 模块页面导出按钮：Word 模块直接导出原文件，其他模块弹出格式选择
  handleModuleExport(moduleId) {
    const wordModules = ['weekly', 'monthly', 'meeting', 'activity', 'talk', 'friendship'];
    if (wordModules.includes(moduleId)) {
      const selectedIds = this.getSelectedRecordIds(moduleId);
      Exporter.exportModuleSourceFiles(moduleId, selectedIds);
    } else {
      this.openExportModal(moduleId);
    }
  },

  // 根据文件扩展名自动处理导入
  handleImportFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const moduleId = this.importTargetModule;

    // 文件型模块：上传一个文件就存为一个文件附件，不解析成表格记录
    if (MODULE_CONFIG[moduleId] && MODULE_CONFIG[moduleId].type === 'file') {
      const fmtMap = {xlsx:'excel', xls:'excel', csv:'excel', doc:'word', docx:'word', pdf:'pdf', ppt:'ppt', pptx:'ppt'};
      const fmt = fmtMap[ext] || 'excel';
      Exporter.importAsAttachment(moduleId, file, fmt, this.importLabelValue);
      this.importLabelValue = null;
      return;
    }

    // 大文件友好提示（不阻止导入，但提醒用户可能存储较慢或失败）
    if (file.size > 10 * 1024 * 1024) {
      const sizeMB = (file.size / 1024 / 1024).toFixed(1);
      this.toast(`文件较大（${sizeMB}MB），正在处理，请稍候...`, 'warning');
    }

    if (moduleId === '_backup' || ext === 'json') {
      Exporter.importBackup(file);
      return;
    }

    if (['xlsx', 'xls', 'csv'].includes(ext)) {
      Exporter.importExcel(moduleId, file, this.importLabelValue);
      this.importLabelValue = null;
    } else if (['doc', 'docx'].includes(ext)) {
      const supportedWordModules = ['weekly', 'monthly', 'meeting', 'activity', 'talk', 'friendship'];
      if (ext === 'docx' && supportedWordModules.includes(moduleId)) {
        Exporter.importWord(moduleId, file);
      } else {
        Exporter.importAsAttachment(moduleId, file, 'word');
      }
    } else if (ext === 'pdf') {
      Exporter.importAsAttachment(moduleId, file, 'pdf');
    } else if (['ppt', 'pptx'].includes(ext)) {
      Exporter.importAsAttachment(moduleId, file, 'ppt');
    } else if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(ext)) {
      if (moduleId === 'schedule') {
        this.importScheduleImage(file);
      } else {
        this.toast('图片仅支持导入到"课表安排"模块', 'warning');
      }
    } else {
      this.toast('不支持的文件格式，请上传 Excel / 图片 / Word / PDF / PPT 文件', 'warning');
    }
  },

  // ===== 课表图片识别导入（OCR） =====
  async importScheduleImage(file) {
    const data = await Exporter.recognizeScheduleImage(file);
    if (data && Object.keys(data).length > 0) {
      this.showScheduleImportConfirm(data);
    } else {
      this.toast('未从图片中识别出课程，请确认图片是清晰的课表截图', 'warning');
    }
  },

  // 显示课表识别结果确认界面（可编辑修正）
  showScheduleImportConfirm(data) {
    const config = MODULE_CONFIG.schedule;
    const days = config.days;
    const periods = config.periods;

    let html = `
      <div class="schedule-confirm-wrap">
        <p style="color:var(--text-secondary);font-size:13px;margin-bottom:10px;">以下是从图片/表格中识别出的课表，请核对修正后点击<strong>"确认导入"</strong>。格式：<code>课程名 教师 @教室</code> 或 <code>课程名</code></p>
        <div style="overflow:auto;max-height:60vh;">
        <table class="schedule-confirm-table">
          <thead><tr><th>节次</th>${days.map(d => `<th>${d}</th>`).join('')}</tr></thead>
          <tbody>`;
    periods.forEach((period, pi) => {
      html += `<tr><td class="period-cell">${period.name}<br><span style="font-size:10px;color:var(--text-light);">${period.time}</span></td>`;
      days.forEach((day, di) => {
        const cell = data[`${pi}-${di}`];
        const val = cell ? (cell.subject + (cell.teacher ? ' 教师:' + cell.teacher : '') + (cell.location ? ' @' + cell.location : '')) : '';
        html += `<td><input data-key="${pi}-${di}" class="sched-confirm-input" value="${this.escapeAttr(val)}" placeholder="＋"></td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table></div></div>';

    document.getElementById('modal-title').textContent = '📅 课表识别结果确认';
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-secondary" style="margin-right:auto;" onclick="App.schedConfirmClear()">🗑 清空全部</button>
      <button class="btn btn-success" onclick="App.confirmScheduleImport()">✅ 确认导入</button>
      <button class="btn btn-secondary" onclick="App.closeModal()">取消</button>
    `;
    this.openModal();
  },

  // 清空确认界面输入
  schedConfirmClear() {
    document.querySelectorAll('.sched-confirm-input').forEach(inp => inp.value = '');
  },

  // 确认导入课表识别结果
  confirmScheduleImport() {
    const inputs = document.querySelectorAll('.sched-confirm-input');
    const scheduleData = {};
    inputs.forEach(inp => {
      const val = inp.value.trim();
      if (!val) return;
      const key = inp.getAttribute('data-key');
      const cell = Exporter._parseScheduleCell(val);
      if (cell.subject) scheduleData[key] = cell;
    });
    if (Object.keys(scheduleData).length === 0) {
      this.toast('没有可导入的课程，请先填写课程', 'warning');
      return;
    }
    Store.saveSchedule(scheduleData);
    this.closeModal();
    this.renderSchedule('schedule');
    this.toast(`📥 成功导入 ${Object.keys(scheduleData).length} 节课`, 'success');
  },

  // ===== 属性转义（用于 input value） =====
  escapeAttr(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  // 单个导入按钮：直接弹出系统文件选择框
  openImportModal(moduleId) {
    this.importTargetModule = moduleId === 'all' ? '_backup' : moduleId;
    const input = document.getElementById('file-input');
    if (moduleId === 'schedule') {
      input.accept = '.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp,.bmp';
    } else {
      input.accept = '.xlsx,.xls,.doc,.docx,.pdf,.ppt,.pptx,.json';
    }
    // 考勤三模块/课表：需要逐个填写周次/月份/确认，保持单文件；其余模块支持一次多选批量上传
    input.multiple = !(moduleId === 'weekend' || moduleId === 'leave' || moduleId === 'absence' || moduleId === 'schedule');
    // 考勤三模块：先弹窗让用户填写 周次/月份 标识，再选择文件导入
    if (moduleId === 'weekend' || moduleId === 'leave' || moduleId === 'absence') {
      this.promptImportLabel(moduleId);
      return;
    }
    input.click();
  },

  // 考勤模块导入前：弹窗填写 周次/月份 标识
  promptImportLabel(moduleId) {
    const config = MODULE_CONFIG[moduleId];
    const isWeekend = moduleId === 'weekend';
    const labelName = isWeekend ? '周次' : '月份';
    const placeholder = isWeekend ? '例如：第3周 / 3' : '例如：9月 / 9';

    // 构造输入弹窗
    const overlay = document.createElement('div');
    overlay.id = 'import-label-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:24px;width:360px;max-width:90vw;box-shadow:0 20px 60px rgba(0,0,0,.25);">
        <div style="font-size:17px;font-weight:600;color:var(--text-primary);margin-bottom:12px;">📥 导入${this.escapeHtml(config.title)}</div>
        <div style="font-size:13px;color:var(--text-secondary);margin-bottom:14px;">请填写本次数据的<b style="color:var(--primary);">${labelName}</b>，导入后每条记录都会自动标注该${labelName}：</div>
        <input type="text" id="import-label-input" placeholder="${placeholder}" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:14px;outline:none;" />
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">
          <button id="import-label-cancel" class="btn btn-secondary">取消</button>
          <button id="import-label-ok" class="btn btn-success">✅ 确认并选择文件</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = document.getElementById('import-label-input');
    setTimeout(() => input.focus(), 50);

    const close = () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); };
    document.getElementById('import-label-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('import-label-ok').click(); });

    document.getElementById('import-label-ok').addEventListener('click', () => {
      const val = input.value.trim();
      if (!val) { this.toast(`请先填写${labelName}`, 'warning'); input.focus(); return; }
      // 规范化：纯数字补上前缀
      let label = val;
      if (isWeekend) {
        if (/^\d+$/.test(label)) label = '第' + label + '周';
      } else {
        if (/^\d+$/.test(label)) label = label + '月';
      }
      this.importLabelValue = label;
      close();
      const fi = document.getElementById('file-input');
      fi.click();
    });
  },

  // ===== 文件中心 =====
  renderFileCenter() {
    const allFiles = Store.getFiles();
    // 优先从搜索框 DOM 读取当前值（避免渲染后变量与显示不一致）
    const searchInput = document.getElementById('file-search-input');
    const inputVal = searchInput ? searchInput.value : '';
    const q = (inputVal || this.fileSearchQuery || '').trim().toLowerCase();
    // 同步变量
    if (inputVal) this.fileSearchQuery = inputVal;

    // 搜索过滤
    let files = allFiles;
    if (q) {
      files = allFiles.filter(f => {
        return (f.name || '').toLowerCase().includes(q)
          || (f.moduleTitle || '').toLowerCase().includes(q)
          || (f.label || '').toLowerCase().includes(q)
          || (f.module || '').toLowerCase().includes(q);
      });
    }

    // 按模块分组
    const groups = {};
    files.forEach(f => {
      const key = f.module || 'other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    });

    let html = `
      <div class="action-bar">
        <div class="action-bar-left" style="gap:8px;align-items:center;">
          ${(this.currentFolder && !q) ? `<button class="btn btn-sm btn-secondary" onclick="App.backToFileRoot()" style="white-space:nowrap;">← 返回根目录</button>` : ''}
          <div style="position:relative;">
            <input type="text" id="file-search-input" class="search-input" placeholder="🔍 搜索文件名/模块/类型..."
              style="width:280px;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-md);font-size:14px;">
          </div>
          ${q ? `<span style="font-size:13px;color:var(--text-secondary);">找到 ${files.length} 个文件</span>` : ''}
        </div>
        <div class="action-bar-right" style="gap:8px;">
          ${(this.currentFolder && !q) ? `<button class="btn btn-success" onclick="App.exportFolder('${this.currentFolder}')">📤 导出本文件夹</button>` : `<button class="btn btn-success" onclick="App.openExportModal('all')">📤 导出全部</button>`}
          <button class="btn btn-secondary" onclick="App.openImportModal('all')" title="自动识别文件类型：Excel/Word/PDF/PPT/JSON">📥 导入文件</button>
        </div>
      </div>
    `;

    if (allFiles.length === 0) {
      html += `
        <div class="table-container">
          <div class="empty-state">
            <div class="empty-icon">📁</div>
            <p>暂无文件</p>
            <p style="font-size:13px;margin-top:8px;">在各模块页面点击导出按钮或导入文件，文件会自动分类到对应文件夹</p>
          </div>
        </div>
      `;
      return html;
    }

    if (q && files.length === 0) {
      html += `
        <div class="table-container">
          <div class="empty-state">
            <div class="empty-icon">🔍</div>
            <p>未找到匹配"${this.escapeHtml(q)}"的文件</p>
          </div>
        </div>
      `;
      return html;
    }

    // 搜索模式：平铺显示所有匹配文件，标注所属模块
    if (q) {
      html += '<div class="file-list">';
      files.forEach(file => {
        html += this._renderFileItem(file, true);
      });
      html += '</div>';
      return html;
    }

    // 文件夹模式
    if (!this.currentFolder) {
      // 根目录：显示所有模块文件夹
      const moduleOrder = ['students', 'schedule', 'duty', 'weekly', 'monthly', 'talk', 'friendship', 'meeting', 'activity', 'leaders', 'all', 'other'];
      const sortedKeys = Object.keys(groups).sort((a, b) => {
        const ia = moduleOrder.indexOf(a), ib = moduleOrder.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      });

      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;padding:8px 0;">';
      sortedKeys.forEach(key => {
        const moduleFiles = groups[key];
        const cfg = MODULE_CONFIG[key] || {};
        const title = cfg.title || (key === 'all' ? '全部导出' : (key === 'other' ? '其他' : key));
        const icon = cfg.icon || (key === 'all' ? '📦' : '📁');
        const color = cfg.color || '#6b7280';
        const totalSize = moduleFiles.reduce((s, f) => s + (f.size || 0), 0);
        const sizeStr = totalSize > 1048576 ? (totalSize / 1048576).toFixed(1) + ' MB' : (totalSize > 1024 ? (totalSize / 1024).toFixed(0) + ' KB' : totalSize + ' B');

        html += `
          <div class="folder-card" onclick="App.openFolder('${key}')" style="cursor:pointer;padding:20px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--card-bg);transition:all .2s;" onmouseover="this.style.borderColor='${color}';this.style.boxShadow='0 4px 12px ${color}22';" onmouseout="this.style.borderColor='var(--border)';this.style.boxShadow='none';">
            <div style="font-size:36px;margin-bottom:8px;">${icon}</div>
            <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">${this.escapeHtml(title)}</div>
            <div style="font-size:13px;color:var(--text-secondary);">${moduleFiles.length} 个文件 · ${sizeStr}</div>
            <div style="margin-top:8px;font-size:12px;color:${color};">点击打开 →</div>
          </div>
        `;
      });
      html += '</div>';
      return html;
    }

    // 文件夹内：显示该模块的文件
    const folderFiles = groups[this.currentFolder] || [];
    const cfg = MODULE_CONFIG[this.currentFolder] || {};
    const folderTitle = cfg.title || (this.currentFolder === 'all' ? '全部导出' : this.currentFolder);
    html += `<div style="padding:8px 0 16px;font-size:14px;color:var(--text-secondary);">📂 <strong style="color:var(--text-primary);">${this.escapeHtml(folderTitle)}</strong> · 共 ${folderFiles.length} 个文件</div>`;

    if (folderFiles.length === 0) {
      html += `<div class="empty-state"><div class="empty-icon">📭</div><p>此文件夹暂无文件</p></div>`;
      return html;
    }

    html += '<div class="file-list">';
    folderFiles.forEach(file => {
      html += this._renderFileItem(file, false);
    });
    html += '</div>';

    return html;
  },

  // 绑定文件中心搜索框的输入事件（input + compositionend）
  _bindFileSearchEvents() {
    const input = document.getElementById('file-search-input');
    if (!input || input._boundSearch) return;
    input._boundSearch = true;
    // 恢复之前的搜索词
    if (this.fileSearchQuery && !input.value) input.value = this.fileSearchQuery;
    input.addEventListener('input', (e) => {
      this.fileSearchQuery = input.value;
      // 中文拼音输入阶段不触发搜索
      if (e.isComposing || e.inputType === 'insertCompositionText' || this._fileSearchComposing) return;
      clearTimeout(this._fileSearchTimer);
      this._fileSearchTimer = setTimeout(() => {
        this.renderModule('files');
      }, 400);
    });
    input.addEventListener('compositionstart', () => {
      this._fileSearchComposing = true;
    });
    input.addEventListener('compositionend', (e) => {
      this._fileSearchComposing = false;
      // 延迟读取，确保 input.value 已更新为中文
      setTimeout(() => {
        this.fileSearchQuery = input.value || (e.data || '');
        clearTimeout(this._fileSearchTimer);
        this._fileSearchTimer = setTimeout(() => {
          this.renderModule('files');
        }, 150);
      }, 30);
    });
  },

  // 渲染单个文件项（showModule: 是否显示所属模块标签）
  _renderFileItem(file, showModule) {
    const fmt = FILE_FORMATS.find(f => f.id === file.type) || {};
    const icon = fmt.icon || '📄';
    const bgStyle = fmt.color ? `background:${fmt.color}15;color:${fmt.color};` : '';
    const date = new Date(file.createdAt);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const countStr = file.isAttachment ? '附件' : (file.recordCount === -1 ? '全部模块' : `${file.recordCount} 条记录`);
    const sizeStr = file.size ? (file.size > 1048576 ? (file.size / 1048576).toFixed(1) + 'MB' : (file.size > 1024 ? (file.size / 1024).toFixed(0) + 'KB' : file.size + 'B')) : '';

    return `
      <div class="file-item">
        <div class="file-icon" style="${bgStyle}width:44px;height:44px;display:flex;align-items:center;justify-content:center;border-radius:var(--radius-md);font-size:20px;flex-shrink:0;">${icon}</div>
        <div class="file-info" style="flex:1;min-width:0;">
          <div class="file-name" style="font-size:14px;font-weight:500;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this.escapeHtml(file.name)}</div>
          <div class="file-meta" style="font-size:12px;color:var(--text-secondary);margin-top:2px;">
            ${showModule ? `<span style="color:var(--primary);">${this.escapeHtml(file.moduleTitle || file.module || '')}</span> · ` : ''}
            ${countStr}${sizeStr ? ' · ' + sizeStr : ''} · ${dateStr}
          </div>
        </div>
        <div class="file-actions" style="display:flex;gap:6px;align-items:center;flex-shrink:0;">
          <button class="btn btn-sm btn-primary" onclick="event.stopPropagation();App.openFileView('${file.id}')" title="在线预览/打开">👁️ 查看</button>
          <button class="btn-icon" title="下载" onclick="event.stopPropagation();App.downloadFileRecord('${file.id}')">⬇️</button>
          <button class="btn-icon danger" title="删除" onclick="event.stopPropagation();App.deleteFileRecord('${file.id}')">🗑️</button>
        </div>
      </div>
    `;
  },

  openFolder(moduleId) {
    this.currentFolder = moduleId;
    this.renderModule('files');
  },

  backToFileRoot() {
    this.currentFolder = null;
    this.renderModule('files');
  },

  handleFileSearch(value, event) {
    this.fileSearchQuery = value;
    // 中文输入法输入过程中（拼音阶段）不触发渲染，避免打断组合输入
    if (event && (event.isComposing || event.inputType === 'insertCompositionText')) return;
    if (this._fileSearchComposing) return;
    clearTimeout(this._fileSearchTimer);
    this._fileSearchTimer = setTimeout(() => {
      this.renderModule('files');
      this._restoreFileSearchFocus();
    }, 400);
  },

  // 中文输入法输入完成后触发搜索
  handleFileSearchCompositionEnd(value, event) {
    this._fileSearchComposing = false;
    // compositionend 事件的 data 属性包含上屏的中文文本（优先使用，避免 value 还没更新）
    const finalValue = (event && event.data) ? event.data : value;
    this.fileSearchQuery = finalValue;
    clearTimeout(this._fileSearchTimer);
    // 延迟一点再渲染，确保 input.value 已更新为中文
    this._fileSearchTimer = setTimeout(() => {
      const input = document.getElementById('file-search-input');
      if (input && input.value) this.fileSearchQuery = input.value;
      this.renderModule('files');
      this._restoreFileSearchFocus();
    }, 80);
  },

  // 渲染后恢复搜索框焦点和光标位置
  _restoreFileSearchFocus() {
    setTimeout(() => {
      const input = document.getElementById('file-search-input');
      if (input) {
        input.focus();
        const len = input.value.length;
        if (input.setSelectionRange) input.setSelectionRange(len, len);
      }
    }, 10);
  },

  downloadFileRecord(fileId) {
    const files = Store.getFiles();
    const file = files.find(f => f.id === fileId);
    if (!file || !file.content) {
      this.toast('文件内容不存在', 'error');
      return;
    }
    const mimeMap = {
      'word': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'excel': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'pdf': 'application/pdf',
      'ppt': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    };
    const mime = file.mimeType || mimeMap[file.type] || 'application/octet-stream';
    const byteChars = atob(file.content);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const blob = new Blob([new Uint8Array(byteNumbers)], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 延迟撤销 URL：安卓浏览器（尤其 PWA 全屏模式）需要时间开始下载，
    // 立即 revoke 会导致下载失败
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch (e) {}
    }, 8000);
  },

  exportFolder(moduleId) {
    const files = Store.getFiles().filter(f => f.module === moduleId);
    if (files.length === 0) {
      this.toast('此文件夹没有可导出的文件', 'warning');
      return;
    }
    Exporter.exportModuleSourceFiles(moduleId, null);
  },

  openFileView(fileId) {
    const files = Store.getFiles();
    const file = files.find(f => f.id === fileId);
    if (!file) return;
    Exporter.openAttachment(file);
  },

  deleteFileRecord(fileId) {
    this.showConfirm('删除文件', '确定要删除这个文件吗？关联的模块记录也会一并删除。', () => {
      // 1. 删除文件中心的文件
      Store.deleteFile(fileId);
      // 2. 同步删除所有模块中关联该文件的记录（通过 sourceFile.fileId 匹配）
      Object.keys(MODULE_CONFIG).forEach(mid => {
        if (MODULE_CONFIG[mid].type !== 'table') return;
        const records = Store.get(mid) || [];
        const filtered = records.filter(r => {
          if (!r.sourceFile) return true;
          if (typeof r.sourceFile === 'string') return true;
          return r.sourceFile.fileId !== fileId;
        });
        if (filtered.length !== records.length) {
          Store.save(mid, filtered);
        }
      });
      this.renderModule('files');
      this.toast('文件及关联记录已删除', 'success');
    });
  },

  // ===== 设置页面 =====
  renderSettings() {
    const stats = Store.getStats();
    let totalRecords = 0;
    Object.values(stats).forEach(v => { totalRecords += v; });
    const cloud = Store.CLOUD || {};
    const syncStatusText = {
      idle: '✅ 已同步',
      pulling: '⬇️ 正在从云端拉取...',
      pushing: '⬆️ 正在推送到云端...',
      error: '⚠️ 同步失败'
    }[cloud.syncStatus || 'idle'] || '✅ 正常';
    const lastSync = cloud.lastSyncTime ? new Date(cloud.lastSyncTime).toLocaleString('zh-CN') : '尚未同步';

    return `
      <div class="settings-card">
        <h3>☁️ 云端同步</h3>
        <div class="settings-row">
          <label>同步状态</label>
          <span class="settings-value" id="cloud-sync-status">${syncStatusText}</span>
        </div>
        <div class="settings-row">
          <label>最后同步时间</label>
          <span class="settings-value">${lastSync}</span>
        </div>
        <div class="settings-row">
          <label>云端存储</label>
          <span class="settings-value">GitHub Gist（私密）</span>
        </div>
        <div class="settings-row">
          <label>手动同步</label>
          <button class="btn btn-sm btn-primary" onclick="App.manualSync()">🔄 立即同步</button>
        </div>
        <div style="margin-top:12px;padding:10px;background:var(--primary-bg);border-radius:var(--radius-sm);font-size:12px;color:var(--text-secondary);">
          💡 数据自动同步到云端，在任何设备打开网址都能看到相同数据。修改后约3秒自动上传。
        </div>
      </div>

      <div class="settings-card">
        <h3>📊 数据统计</h3>
        <div class="settings-row">
          <label>总记录数</label>
          <span class="settings-value">${totalRecords} 条</span>
        </div>
        <div class="settings-row">
          <label>导出文件数</label>
          <span class="settings-value">${Store.getFiles().length} 个</span>
        </div>
        <div class="settings-row">
          <label>数据存储位置</label>
          <span class="settings-value">云端同步 + 本地缓存</span>
        </div>
      </div>

      <div class="settings-card">
        <h3>💾 数据管理</h3>
        <div class="settings-row">
          <label>导出全部数据（JSON备份）</label>
          <button class="btn btn-sm btn-primary" onclick="Exporter.exportBackup()">导出备份</button>
        </div>
        <div class="settings-row">
          <label>从备份恢复数据</label>
          <button class="btn btn-sm btn-secondary" onclick="App.openImportModal('all')">选择文件</button>
        </div>
        <div class="settings-row">
          <label>导出全部数据（Excel/Word/PDF/PPT）</label>
          <button class="btn btn-sm btn-success" onclick="App.openExportModal('all')">📤 选择格式导出</button>
        </div>
      </div>

      <div class="settings-card">
        <h3>⚙️ 系统操作</h3>
        <div class="settings-row">
          <label>重新加载示例数据</label>
          <button class="btn btn-sm btn-warning" onclick="App.resetData()">重置数据</button>
        </div>
        <div class="settings-row">
          <label>清空所有数据</label>
          <button class="btn btn-sm btn-danger" onclick="App.clearAllData()">清空数据</button>
        </div>
      </div>

      <div class="settings-card">
        <h3>ℹ️ 关于</h3>
        <div class="settings-row">
          <label>应用名称</label>
          <span class="settings-value">班委工作台</span>
        </div>
        <div class="settings-row">
          <label>版本</label>
          <span class="settings-value">v1.7.0（云同步版）</span>
        </div>
        <div class="settings-row">
          <label>支持格式</label>
          <span class="settings-value">Excel / Word / PDF / PPT</span>
        </div>
        <div class="settings-row">
          <label>功能模块</label>
          <span class="settings-value">${Object.keys(MODULE_CONFIG).length} 个</span>
        </div>
        <div style="margin-top:16px;padding:12px;background:var(--primary-bg);border-radius:var(--radius-sm);font-size:13px;color:var(--primary);">
          💡 数据已开启云端同步，在任何设备打开网址都能看到相同数据。建议定期导出备份。导出的文件可使用 WPS 或 Microsoft Office 打开编辑。
        </div>
      </div>
    `;
  },

  // ===== 手动云同步 =====
  async manualSync() {
    const statusEl = document.getElementById('cloud-sync-status');
    if (statusEl) statusEl.textContent = '🔄 正在同步...';
    this.toast('正在同步云端数据…', 'info');
    try {
      const result = await Store.syncNow();
      const pullOk = result.pull && result.pull.success;
      const pushOk = result.push && result.push.success;
      if (pullOk && pushOk) {
        if (statusEl) statusEl.textContent = '✅ 已同步';
        this.toast('✅ 云端同步完成，所有设备数据一致', 'success');
      } else if (pullOk && !pushOk) {
        if (statusEl) statusEl.textContent = '⏳ 待上传';
        this.toast('已获取云端最新数据；本机改动暂时上传失败，网络恢复后会自动重试', 'warning');
      } else {
        if (statusEl) statusEl.textContent = '⚠️ 同步失败';
        this.toast('云端暂时连不上，数据已保存在本机，网络恢复后自动同步（也可稍后再点此按钮重试）', 'warning');
      }
      this.renderModule(this.currentModule);
    } catch (e) {
      if (statusEl) statusEl.textContent = '⚠️ 同步失败';
      this.toast('同步失败：' + String(e), 'error');
    }
  },

  resetData() {
    this.showConfirm('重置数据', '确定要重置为示例数据吗？当前数据将被覆盖！', () => {
      // 清除所有模块数据和文件中心
      Object.keys(MODULE_CONFIG).forEach(moduleId => {
        localStorage.removeItem(Store.getKey(moduleId));
      });
      localStorage.removeItem(Store.FILE_PREFIX);
      localStorage.removeItem(Store.INIT_KEY);
      Store.init();
      this.renderModule('settings');
      this.toast('数据已重置为示例数据', 'success');
    });
  },

  clearAllData() {
    this.showConfirm('⚠️ 危险操作', '确定要清空所有数据吗？此操作不可撤销！所有记录将被永久删除（含云端数据）！', async () => {
      this.toast('正在清空数据（含云端）...', 'info');
      await Store.clearAll();
      this.renderModule('settings');
      this.toast('所有数据已清空（含云端）', 'success');
    });
  },

  // ===== 模态框管理 =====
  openModal() {
    document.getElementById('modal-overlay').classList.add('show');
  },

  closeModal() {
    document.getElementById('modal-overlay').classList.remove('show');
    this.editingId = null;
  },

  // ===== 确认对话框 =====
  showConfirm(title, message, callback) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-overlay').classList.add('show');

    const okBtn = document.getElementById('confirm-ok');
    // 克隆替换以移除旧的事件监听
    const newOkBtn = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOkBtn, okBtn);
    newOkBtn.addEventListener('click', () => {
      this.closeConfirm();
      callback();
    });
  },

  closeConfirm() {
    document.getElementById('confirm-overlay').classList.remove('show');
  },

  // ===== Toast通知 =====
  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };

    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
      <span class="toast-message">${this.escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastIn 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  // ===== HTML转义 =====
  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }
};

// ===== 启动应用 =====
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
