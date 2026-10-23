/* ============================================
   班委工作台 - 导入导出模块
   支持格式: Excel / Word / PDF / PPT
   ============================================ */

const Exporter = {

  // 防止同一个 cloudLimited 文件在 3 秒内重复弹出 toast
  _cloudLimitedToastAt: {},

  // ===== 统一导出入口 =====
  // options: { recordIds: string[], openMode: boolean }
  exportFile(moduleId, format, options = {}) {
    switch (format) {
      case 'excel': this.exportExcel(moduleId, options.recordIds, true, options.openMode); break;
      case 'word': this.exportWord(moduleId, options.recordIds, true, options.openMode); break;
      case 'pdf': this.exportPDF(moduleId, options.recordIds, true, options.openMode); break;
      case 'ppt': this.exportPPT(moduleId, options.recordIds, true, options.openMode); break;
    }
  },

  // ============================
  //  直接打开原始源文件
  // ============================
  //
  // 设计目标：
  //  1. 点击后由浏览器/系统直接打开，不走"下载→点开"流程
  //  2. 文件名始终保持原始文件名（包含中文）
  //  3. 走新标签页打开，文件名在 Content-Disposition 中以原名返回

  openSourceFile(assetUrl) {
    // 如果 sourceFile 是一个对象（导入的文件），通过 fileId 从文件中心获取
    if (typeof assetUrl === 'object' && assetUrl.fileId) {
      const files = Store.getFiles();
      const fileInfo = files.find(f => f.id === assetUrl.fileId);
      if (fileInfo) {
        this.openAttachment(fileInfo);
        return;
      }
    }
    // 静态资源路径：应用内在线预览（Office Online / PDF / 图片），不再触发下载
    const fileName = assetUrl.split('/').pop();
    this.previewDocument(assetUrl, fileName);
  },

  // ===== 在线文档预览（替代直接下载）=====
  // URL 文件：Word / Excel / PPT 用微软官方在线查看器渲染，PDF / 图片直接内嵌；
  // base64 附件（用户上传/导入的文件）：用纯前端库 docx-preview / SheetJS 渲染。
  // 任何电脑联网即可预览，无需安装 WPS / Office，也不会弹出浏览器下载窗口。
  previewDocument(fileUrl, fileName) {
    // base64 / Data URL 附件：纯前端渲染
    if (this._isBase64Payload(fileUrl)) {
      this.previewBase64Content(fileUrl, fileName);
      return true;
    }

    // 转为绝对 URL
    let absoluteUrl = fileUrl;
    if (fileUrl.startsWith('/')) {
      absoluteUrl = window.location.origin + fileUrl;
    } else if (!/^https?:\/\//i.test(fileUrl)) {
      absoluteUrl = window.location.origin + '/' + fileUrl;
    }

    // 提取文件名（可能带 URL 编码）
    let name = fileName || decodeURIComponent(absoluteUrl.split('/').pop() || '文档预览');

    // 根据文件类型选择预览方式
    const ext = name.split('.').pop().toLowerCase();
    const officeExts = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
    const directExts = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'txt', 'csv'];
    let previewSrc;
    if (officeExts.includes(ext)) {
      // Office 在线查看器（微软官方，无需登录）
      previewSrc = 'https://view.officeapps.live.com/op/view.aspx?src=' + encodeURIComponent(absoluteUrl);
    } else if (directExts.includes(ext)) {
      previewSrc = absoluteUrl;
    } else {
      // 未知类型也尝试 Office 在线查看器
      previewSrc = 'https://view.officeapps.live.com/op/view.aspx?src=' + encodeURIComponent(absoluteUrl);
    }

    this._openPreviewShell(name, absoluteUrl, 'iframe', previewSrc);
    App.toast('📄 正在打开文档预览...', 'info');
    return true;
  },

  // 判断是否为 base64 / Data URL 内容
  _isBase64Payload(str) {
    if (typeof str !== 'string' || !str) return false;
    if (/^data:/i.test(str)) return true;
    const s = str.trim();
    // 常见文件类型的 base64 魔数（docx/xlsx/pptx=UEsDB，pdf=JVBERi0，png=iVBOR，
    // gif=R0lGOD，jpg=/9j/，bmp=Qk0，webp=UklGR）
    if (/^(UEsDB|JVBERi0|iVBOR|R0lGOD|\/9j\/|Qk0|UklGR|SUQq)/.test(s)) return true;
    // 通用 base64 特征：字符集 + 长度
    if (s.length > 100 && /^[A-Za-z0-9+/]+={0,2}$/.test(s)) return true;
    return false;
  },

  // 创建 / 复用预览模态框（标题栏 + 下载按钮 + iframe / html 双容器）
  _ensurePreviewModal() {
    let modal = document.getElementById('doc-preview-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'doc-preview-modal';
    modal.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(15,23,42,0.85);z-index:999999;flex-direction:column;';
    modal.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 20px;background:#0f172a;color:#fff;box-shadow:0 2px 12px rgba(0,0,0,0.3);">' +
        '<span id="doc-preview-title" style="font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:12px;">📄 文档预览</span>' +
        '<div style="display:flex;gap:10px;align-items:center;flex-shrink:0;">' +
          '<a id="doc-preview-download" href="#" style="color:#fff;text-decoration:none;padding:6px 14px;background:#2563eb;border-radius:6px;font-size:13px;font-weight:500;">⬇ 下载原文件</a>' +
          '<button id="doc-preview-close" title="关闭 (Esc)" style="background:none;border:none;color:#fff;font-size:26px;cursor:pointer;padding:0 8px;line-height:1;">&times;</button>' +
        '</div>' +
      '</div>' +
      '<div id="doc-preview-body" style="flex:1;background:#fff;position:relative;overflow:auto;">' +
        '<div id="doc-preview-loading" style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fff;color:#64748b;">' +
          '<div style="font-size:44px;margin-bottom:14px;">📄</div>' +
          '<div style="font-size:15px;">正在加载文档预览...</div>' +
          '<div style="font-size:12px;margin-top:8px;color:#94a3b8;">若长时间未加载，请点击右上角“下载原文件”在本地查看</div>' +
        '</div>' +
        '<iframe id="doc-preview-iframe" style="width:100%;height:100%;border:none;display:none;"></iframe>' +
        '<div id="doc-preview-html" style="display:none;padding:24px;background:#fff;min-height:100%;box-sizing:border-box;"></div>' +
      '</div>';
    document.body.appendChild(modal);

    // 关闭按钮
    const closeBtn = document.getElementById('doc-preview-close');
    closeBtn.addEventListener('click', function () {
      modal.style.display = 'none';
      const iframe = document.getElementById('doc-preview-iframe');
      iframe.src = 'about:blank';
      iframe.style.display = 'none';
      const htmlEl = document.getElementById('doc-preview-html');
      htmlEl.style.display = 'none';
      htmlEl.innerHTML = '';
      const loading = document.getElementById('doc-preview-loading');
      loading.style.display = 'flex';
    });
    // 点击遮罩关闭
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeBtn.click();
    });
    // ESC 关闭
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.style.display === 'flex') closeBtn.click();
    });
    return modal;
  },

  // 打开预览外壳（mode: 'iframe' 用 iframe 预览；'html' 用内部 div 渲染）
  _openPreviewShell(name, downloadUrl, mode, iframeSrc, downloadHandler) {
    const modal = this._ensurePreviewModal();
    const titleEl = document.getElementById('doc-preview-title');
    const dlLink = document.getElementById('doc-preview-download');
    const iframe = document.getElementById('doc-preview-iframe');
    const htmlEl = document.getElementById('doc-preview-html');
    const loading = document.getElementById('doc-preview-loading');

    titleEl.textContent = '📄 ' + name;

    // 下载按钮：base64 内容走内存下载，URL 内容走超链接
    if (downloadHandler) {
      dlLink.removeAttribute('href');
      dlLink.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        try { downloadHandler(); } catch (err) { console.error(err); }
      };
    } else {
      dlLink.onclick = null;
      dlLink.href = downloadUrl || '#';
      dlLink.download = name;
    }

    // 重置状态
    modal.style.display = 'flex';
    loading.style.display = 'flex';
    iframe.style.display = 'none';
    iframe.src = 'about:blank';
    htmlEl.style.display = 'none';
    htmlEl.innerHTML = '';

    if (mode === 'iframe') {
      let loaded = false;
      const onLoad = function () {
        if (loaded) return;
        loaded = true;
        loading.style.display = 'none';
        iframe.style.display = 'block';
      };
      iframe.onload = onLoad;
      // 兜底：8 秒后仍未触发 onload 也展示 iframe
      setTimeout(function () {
        if (!loaded) {
          loading.style.display = 'none';
          iframe.style.display = 'block';
        }
      }, 8000);
      iframe.src = iframeSrc;
    }
    // html 模式：等待渲染完成回调 _finishHtmlPreview()
  },

  // 结束 html 渲染（隐藏 loading，展示渲染内容）
  _finishHtmlPreview() {
    const loading = document.getElementById('doc-preview-loading');
    const htmlEl = document.getElementById('doc-preview-html');
    if (loading) loading.style.display = 'none';
    if (htmlEl) htmlEl.style.display = 'block';
  },

  // html 渲染失败/不支持时的提示
  _renderHtmlPreviewError() {
    const htmlEl = document.getElementById('doc-preview-html');
    if (htmlEl) {
      htmlEl.innerHTML =
        '<div style="padding:60px 24px;text-align:center;color:#64748b;">' +
          '<div style="font-size:48px;margin-bottom:14px;">📄</div>' +
          '<div style="font-size:15px;margin-bottom:8px;">该文件类型暂不支持在线预览</div>' +
          '<div style="font-size:13px;color:#94a3b8;">请点击右上角“下载原文件”，用 WPS / Office 在本地打开查看。</div>' +
        '</div>';
    }
    this._finishHtmlPreview();
  },

  // base64 → Uint8Array（兼容 data: URL 前缀）
  _base64ToUint8(base64) {
    try {
      let b64 = base64;
      if (/^data:/i.test(b64)) {
        b64 = b64.split(',')[1] || '';
      }
      b64 = b64.replace(/\s/g, '');
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch (e) {
      console.error('base64 解码失败:', e);
      return null;
    }
  },

  // base64 附件纯前端在线预览（docx → docx-preview；xlsx → SheetJS；pdf/图片 → iframe）
  previewBase64Content(base64, fileName) {
    const name = fileName || '文档预览';
    const ext = (name.split('.').pop() || '').toLowerCase();
    const u8 = this._base64ToUint8(base64);
    if (!u8) {
      App.toast('文件内容解析失败', 'error');
      return;
    }

    // Word：docx-preview 纯前端渲染
    if (ext === 'docx') {
      this._openPreviewShell(name, null, 'html', null, () => {
        this._downloadUint8(name, u8, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      });
      if (typeof docx !== 'undefined') {
        const blob = new Blob([u8], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        docx.renderAsync(blob, document.getElementById('doc-preview-html'))
          .then(() => this._finishHtmlPreview())
          .catch(err => { console.error('docx 渲染失败:', err); this._renderHtmlPreviewError(); });
      } else {
        this._renderHtmlPreviewError();
      }
      return;
    }

    // Excel / CSV：SheetJS 渲染为表格
    if (['xlsx', 'xls', 'csv'].includes(ext)) {
      this._openPreviewShell(name, null, 'html', null, () => {
        const mime = ext === 'csv' ? 'text/csv' : (ext === 'xls' ? 'application/vnd.ms-excel' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        this._downloadUint8(name, u8, mime);
      });
      try {
        const wb = XLSX.read(u8, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const html = XLSX.utils.sheet_to_html(ws);
        document.getElementById('doc-preview-html').innerHTML = html;
        this._finishHtmlPreview();
      } catch (e) {
        console.error('Excel 渲染失败:', e);
        this._renderHtmlPreviewError();
      }
      return;
    }

    // PDF / 图片：Blob URL iframe 内嵌
    if (ext === 'pdf' || ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) {
      const mime = ext === 'pdf' ? 'application/pdf' : ('image/' + (ext === 'jpg' ? 'jpeg' : ext));
      const blob = new Blob([u8], { type: mime });
      const url = URL.createObjectURL(blob);
      this._openPreviewShell(name, url, 'iframe', url, () => this._downloadUint8(name, u8, mime));
      setTimeout(() => URL.revokeObjectURL(url), 120000);
      return;
    }

    // doc / ppt / pptx 等：暂不支持纯前端渲染，提供下载原文件
    this._openPreviewShell(name, null, 'html', null, () => {
      this._downloadUint8(name, u8, 'application/octet-stream');
    });
    this._renderHtmlPreviewError();
  },

  // 下载 Uint8Array 内容为文件（保持原文件名）
  _downloadUint8(fileName, u8, mimeType) {
    const blob = new Blob([u8], { type: mimeType || 'application/octet-stream' });
    this.downloadBlob(blob, fileName);
  },

  /**
   * 在新标签页打开一个 URL，文件名通过 download 属性兜底
   * @param {string} url  文件 URL
   * @param {string} fileName  原始文件名（用于兜底）
   * @returns {boolean} 是否成功打开
   */
  openInNewTab(url, fileName) {
    try {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      // 如果浏览器仍然选择下载，download 属性会保证下载下来的文件名为原文件名
      if (fileName) a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    } catch (e) {
      return false;
    }
  },

  // 直接打开单条记录，不保存到文件中心
  openRecord(moduleId, recordId, format) {
    this.exportFile(moduleId, format, { recordIds: [recordId], openMode: true });
  },

  // 批量导出/下载模块内所有关联的原始文件
  async exportModuleSourceFiles(moduleId, recordIds) {
    const config = MODULE_CONFIG[moduleId];
    const all = Store.get(moduleId);
    const targets = recordIds && recordIds.length > 0
      ? all.filter(r => recordIds.includes(r.id))
      : all;

    // 兜底：没有 sourceFile 的记录，从文件中心查找同模块最新文件
    const moduleFiles = Store.getFiles().filter(f => f.module === moduleId && f.content);
    const fallbackFileId = moduleFiles.length > 0 ? moduleFiles[0].id : null;
    const recordsWithSource = targets.map(r => {
      if (r.sourceFile) return r;
      if (fallbackFileId) return { ...r, sourceFile: { fileId: fallbackFileId } };
      return null;
    }).filter(Boolean);

    if (recordsWithSource.length === 0) {
      App.toast('没有可导出的原始文件', 'warning');
      return;
    }

    App.toast(`📄 正在准备 ${recordsWithSource.length} 个原始文件...`, 'info');

    // 收集文件信息 { name, blob }
    const files = [];
    for (const record of recordsWithSource) {
      let fileName = '';
      let blob = null;

      if (typeof record.sourceFile === 'string') {
        const assetUrl = record.sourceFile;
        fileName = decodeURIComponent(assetUrl.split('/').pop());
        try {
          const res = await fetch(assetUrl);
          if (!res.ok) throw new Error('fetch failed');
          blob = await res.blob();
        } catch (err) {
          console.warn('下载失败:', assetUrl, err);
          continue;
        }
      } else if (record.sourceFile && record.sourceFile.fileId) {
        const fileList = Store.getFiles();
        const fileInfo = fileList.find(f => f.id === record.sourceFile.fileId);
        if (!fileInfo) continue;
        fileName = fileInfo.name;
        if (fileInfo.assetUrl) {
          try {
            const res = await fetch(fileInfo.assetUrl);
            if (!res.ok) throw new Error('fetch failed');
            blob = await res.blob();
          } catch (err) {
            console.warn('下载失败:', fileInfo.assetUrl, err);
            continue;
          }
        } else if (fileInfo.isAttachment && fileInfo.content) {
          try {
            const byteCharacters = atob(fileInfo.content);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
              byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            blob = new Blob([byteArray], { type: fileInfo.mimeType || 'application/octet-stream' });
          } catch (err) {
            continue;
          }
        } else if (fileInfo.cloudLimited) {
          console.warn('文件内容尚未同步到云端（仅存在上传设备）:', fileInfo.name);
          App.toast(`⚠️ ${fileInfo.name} 的内容还没上传到云端，已跳过。请在原上传设备打开网站联网停留十几秒自动补传，或重新上传该文件`, 'warning');
          continue;
        }
      }

      if (!blob || !fileName) continue;
      files.push({ name: fileName, blob });
    }

    if (files.length === 0) {
      App.toast('没有可下载的原始文件', 'warning');
      return;
    }

    // 单个文件直接下载，保持原文件名
    if (files.length === 1) {
      this.downloadBlob(files[0].blob, files[0].name);
      App.toast('✅ 已开始下载原文件', 'success');
      return;
    }

    // 多个文件打包成 zip 下载，zip 内部保持原文件名
    if (typeof JSZip !== 'undefined') {
      const zip = new JSZip();
      files.forEach(f => zip.file(f.name, f.blob));
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipName = `${config.title}_原文件汇总_${this.getDateString()}.zip`;
      this.downloadBlob(zipBlob, zipName);
      App.toast(`✅ 已将 ${files.length} 个原文件打包下载`, 'success');
    } else {
      // JSZip 未加载时逐个下载
      App.toast(`⚠️ 将依次下载 ${files.length} 个文件，请允许浏览器下载`, 'info');
      files.forEach((f, idx) => {
        setTimeout(() => this.downloadBlob(f.blob, f.name), idx * 800);
      });
    }
  },

  // 浏览器直接下载 Blob，保持原文件名
  downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'download';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },

  exportAllFiles(format) {
    switch (format) {
      case 'excel': this.exportAllExcel(); break;
      case 'word': this.exportAllWord(); break;
      case 'pdf': this.exportAllPDF(); break;
      case 'ppt': this.exportAllPPT(); break;
    }
  },

  // ===== 记录导出文件 =====
  recordFile(moduleId, config, format, fileName) {
    const fmt = FILE_FORMATS.find(f => f.id === format);
    const data = Store.get(moduleId);
    Store.addFile({
      name: fileName,
      module: moduleId,
      moduleTitle: config.title,
      type: format,
      label: fmt ? fmt.label : format,
      icon: fmt ? fmt.icon : '📄',
      recordCount: config.type === 'schedule' ? Object.keys(Store.getSchedule()).length : (Array.isArray(data) ? data.length : 0)
    });
  },

  // ============================
  //  Excel 导出
  // ============================

  exportExcel(moduleId, recordIds, skipRecord, openMode) {
    const config = MODULE_CONFIG[moduleId];
    if (!config) return;

    let ws;
    const suffix = recordIds ? `_单条记录_${this.getDateString()}` : `_${this.getDateString()}`;
    const fileName = `${config.title}${suffix}.xlsx`;

    if (config.type === 'schedule') {
      ws = this.buildScheduleSheet(moduleId);
    } else {
      let data = Store.get(moduleId);
      if (recordIds && recordIds.length > 0) {
        data = data.filter(r => recordIds.includes(r.id));
      }
      const rows = data.map(r => {
        const row = {};
        config.fields.forEach(f => {
          row[f.label] = r[f.name] !== undefined && r[f.name] !== null ? r[f.name] : '';
        });
        return row;
      });

      if (rows.length === 0) {
        const headerRow = {};
        config.fields.forEach(f => { headerRow[f.label] = ''; });
        rows.push(headerRow);
      }

      ws = XLSX.utils.json_to_sheet(rows, { header: config.fields.map(f => f.label) });
      ws['!cols'] = config.fields.map(f => ({ wch: Math.max(f.label.length * 2 + 2, (f.width || 120) / 8) }));
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, config.title.slice(0, 31));

    if (openMode) {
      const excelData = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([excelData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      this.openBlob(blob, fileName, 'excel');
      App.toast(`📊 正在打开 ${config.title} Excel...`, 'success');
    } else {
      XLSX.writeFile(wb, fileName);
      if (!skipRecord) this.recordFile(moduleId, config, 'excel', fileName);
      App.toast(`📊 ${config.title} Excel导出成功`, 'success');
    }
  },

  exportAllExcel() {
    const wb = XLSX.utils.book_new();
    Object.keys(MODULE_CONFIG).forEach(moduleId => {
      const config = MODULE_CONFIG[moduleId];
      // 文件型模块（请假/缺勤/周末去向）是上传文件容器，不纳入表格类导出
      if (config.type === 'file') return;
      let ws;
      if (config.type === 'schedule') {
        ws = this.buildScheduleSheet(moduleId);
      } else {
        const data = Store.get(moduleId);
        const rows = data.map(r => {
          const row = {};
          config.fields.forEach(f => { row[f.label] = r[f.name] !== undefined ? r[f.name] : ''; });
          return row;
        });
        if (rows.length === 0) {
          const headerRow = {};
          config.fields.forEach(f => { headerRow[f.label] = ''; });
          rows.push(headerRow);
        }
        ws = XLSX.utils.json_to_sheet(rows, { header: config.fields.map(f => f.label) });
        ws['!cols'] = config.fields.map(f => ({ wch: Math.max(f.label.length * 2 + 2, 12) }));
      }
      XLSX.utils.book_append_sheet(wb, ws, config.title.slice(0, 31));
    });

    const fileName = `班委工作台_全部数据_${this.getDateString()}.xlsx`;
    XLSX.writeFile(wb, fileName);
    Store.addFile({ name: fileName, module: 'all', moduleTitle: '全部模块', type: 'excel', label: 'Excel', icon: '📊', recordCount: -1 });
    App.toast('📊 全部数据Excel导出成功', 'success');
  },

  buildScheduleSheet(moduleId) {
    const config = MODULE_CONFIG[moduleId];
    const scheduleData = Store.getSchedule();
    const days = config.days;
    const periods = config.periods;

    const aoa = [];
    aoa.push(['时间段', ...days.map(d => d)]);

    periods.forEach((period, pi) => {
      const row = [`${period.name}\n(${period.time})`];
      days.forEach((day, di) => {
        const cell = scheduleData[`${pi}-${di}`];
        if (cell) {
          row.push(`${cell.subject}\n教师: ${cell.teacher}\n教室: ${cell.location}`);
        } else {
          row.push('');
        }
      });
      aoa.push(row);
    });

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 16 }, ...days.map(() => ({ wch: 20 }))];
    ws['!rows'] = [{ hpt: 25 }, ...periods.map(() => ({ hpt: 55 }))];

    for (let i = 1; i <= periods.length; i++) {
      for (let j = 0; j <= days.length; j++) {
        const cellRef = XLSX.utils.encode_cell({ r: i, c: j });
        if (ws[cellRef]) {
          ws[cellRef].s = { alignment: { wrapText: true, vertical: 'center', horizontal: 'center' } };
        }
      }
    }
    return ws;
  },

  // ============================
  //  Word 导出
  // ============================

  exportWord(moduleId, recordIds, skipRecord, openMode) {
    const config = MODULE_CONFIG[moduleId];
    if (!config) return;
    const suffix = recordIds ? `_单条记录_${this.getDateString()}` : `_${this.getDateString()}`;
    const fileName = `${config.title}${suffix}.doc`;
    const html = this.buildWordHtml(moduleId, config, recordIds);
    const blob = new Blob(['\ufeff' + html], { type: 'application/msword' });

    if (openMode) {
      this.openBlob(blob, fileName, 'word');
      App.toast(`📝 正在打开 ${config.title} Word...`, 'success');
    } else {
      this.downloadBlob(blob, fileName);
      if (!skipRecord) this.recordFile(moduleId, config, 'word', fileName);
      App.toast(`📝 ${config.title} Word导出成功`, 'success');
    }
  },

  exportAllWord() {
    let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">';
    html += '<head><meta charset="utf-8"><title>班委工作台-全部数据</title>';
    html += '<style>body{font-family:宋体,SimSun;font-size:12pt;line-height:1.8;}h1{text-align:center;font-size:18pt;}h2{font-size:14pt;border-bottom:2px solid #2563eb;padding-bottom:6px;margin-top:24px;}table{width:100%;border-collapse:collapse;margin:10px 0;}th,td{border:1px solid #000;padding:5px;font-size:10pt;}th{background:#d6e4ff;text-align:center;}.info{font-size:10pt;color:#666;margin-bottom:16px;}.page-break{page-break-before:always;}</style></head><body>';
    html += `<h1>班委工作台 - 全部数据导出</h1><div class="info">班级：${CLASS_INFO.fullName} &nbsp; 导出时间：${this.getFullDateString()}</div>`;

    Object.keys(MODULE_CONFIG).forEach((moduleId, idx) => {
      const config = MODULE_CONFIG[moduleId];
      // 文件型模块是上传文件容器，不纳入文档类导出
      if (config.type === 'file') return;
      if (idx > 0) html += '<div class="page-break"></div>';
      html += `<h2>${config.icon} ${config.title}</h2>`;
      if (config.type === 'schedule') {
        html += this.buildScheduleHtml(moduleId);
      } else {
        html += this.buildTableHtml(moduleId);
      }
    });

    html += '</body></html>';

    const fileName = `班委工作台_全部数据_${this.getDateString()}.doc`;
    this.downloadFile(fileName, '\ufeff' + html, 'application/msword');
    Store.addFile({ name: fileName, module: 'all', moduleTitle: '全部模块', type: 'word', label: 'Word', icon: '📝', recordCount: -1 });
    App.toast('📝 全部数据Word导出成功', 'success');
  },

  buildWordHtml(moduleId, config, recordIds) {
    let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">';
    html += '<head><meta charset="utf-8"><title>' + config.title + '</title>';
    html += '<style>body{font-family:宋体,SimSun;font-size:12pt;line-height:1.8;}h1{text-align:center;font-size:18pt;margin-bottom:20pt;}table{width:100%;border-collapse:collapse;margin-top:10pt;}th,td{border:1px solid #000;padding:6pt;font-size:11pt;}th{background:#d6e4ff;text-align:center;}.info{font-size:10pt;color:#666;margin-bottom:16px;}</style></head><body>';
    html += `<h1>${config.title}</h1>`;
    html += `<div class="info">班级：${CLASS_INFO.fullName} &nbsp;&nbsp;&nbsp; 导出时间：${this.getFullDateString()}${recordIds ? ' &nbsp;&nbsp; 记录数：' + recordIds.length + ' 条' : ''}</div>`;
    if (config.type === 'schedule') {
      html += this.buildScheduleHtml(moduleId);
    } else {
      html += this.buildTableHtml(moduleId, recordIds);
    }
    html += '</body></html>';
    return html;
  },

  buildTableHtml(moduleId, recordIds) {
    const config = MODULE_CONFIG[moduleId];
    let data = Store.get(moduleId);
    if (recordIds && recordIds.length > 0) {
      data = data.filter(r => recordIds.includes(r.id));
    }
    const fields = config.fields;
    let html = '<table><thead><tr>';
    fields.forEach(f => { html += `<th>${f.label}</th>`; });
    html += '</tr></thead><tbody>';
    if (data.length === 0) {
      html += `<tr><td colspan="${fields.length}" style="text-align:center;color:#999;">暂无数据</td></tr>`;
    } else {
      data.forEach(record => {
        html += '<tr>';
        fields.forEach(f => {
          const val = record[f.name] !== undefined ? record[f.name] : '';
          html += `<td>${this.escapeHtml(String(val))}</td>`;
        });
        html += '</tr>';
      });
    }
    html += '</tbody></table>';
    return html;
  },

  buildScheduleHtml(moduleId) {
    const config = MODULE_CONFIG[moduleId];
    const scheduleData = Store.getSchedule();
    const days = config.days;
    const periods = config.periods;
    let html = '<table><thead><tr><th>时间段</th>';
    days.forEach(d => { html += `<th>${d}</th>`; });
    html += '</tr></thead><tbody>';
    periods.forEach((period, pi) => {
      html += `<tr><td style="text-align:center;font-weight:bold;">${period.name}<br/><span style="font-size:9pt;font-weight:normal;">${period.time}</span></td>`;
      days.forEach((day, di) => {
        const cell = scheduleData[`${pi}-${di}`];
        if (cell) {
          html += `<td style="text-align:center;"><strong>${this.escapeHtml(cell.subject)}</strong><br/><span style="font-size:9pt;">${this.escapeHtml(cell.teacher)}</span><br/><span style="font-size:9pt;">${this.escapeHtml(cell.location)}</span></td>`;
        } else {
          html += '<td style="text-align:center;color:#ccc;">—</td>';
        }
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
  },

  // ============================
  //  PDF 导出 (jsPDF + autotable)
  // ============================

  exportPDF(moduleId, recordIds, skipRecord, openMode) {
    const config = MODULE_CONFIG[moduleId];
    if (!config) return;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // 标题
    doc.setFontSize(16);
    doc.setTextColor(37, 99, 235);
    doc.text(config.title, doc.internal.pageSize.width / 2, 15, { align: 'center' });

    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    const info = `班级：${CLASS_INFO.fullName}    导出时间：${this.getFullDateString()}${recordIds ? '    记录数：' + recordIds.length + ' 条' : ''}`;
    doc.text(info, 14, 24);

    if (config.type === 'schedule') {
      this.buildPDFSchedule(doc, moduleId);
    } else {
      this.buildPDFTable(doc, moduleId, recordIds);
    }

    const suffix = recordIds ? `_单条记录_${this.getDateString()}` : `_${this.getDateString()}`;
    const fileName = `${config.title}${suffix}.pdf`;

    if (openMode) {
      const blob = doc.output('blob');
      this.openBlob(blob, fileName, 'pdf');
      App.toast(`📄 正在打开 ${config.title} PDF...`, 'success');
    } else {
      doc.save(fileName);
      if (!skipRecord) this.recordFile(moduleId, config, 'pdf', fileName);
      App.toast(`📄 ${config.title} PDF导出成功`, 'success');
    }
  },

  exportAllPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // 封面
    doc.setFontSize(22);
    doc.setTextColor(37, 99, 235);
    doc.text('班委工作台 - 全部数据', doc.internal.pageSize.width / 2, 40, { align: 'center' });
    doc.setFontSize(12);
    doc.setTextColor(100, 116, 139);
    doc.text(`班级：${CLASS_INFO.fullName}    导出时间：${this.getFullDateString()}`, doc.internal.pageSize.width / 2, 50, { align: 'center' });

    // 目录
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    let y = 65;
    Object.keys(MODULE_CONFIG).forEach((moduleId, idx) => {
      const c = MODULE_CONFIG[moduleId];
      doc.text(`${idx + 1}. ${c.icon} ${c.title}`, 20, y);
      y += 8;
    });

    // 各模块数据
    Object.keys(MODULE_CONFIG).forEach(moduleId => {
      const config = MODULE_CONFIG[moduleId];
      // 文件型模块是上传文件容器，不纳入 PDF 导出
      if (config.type === 'file') return;
      doc.addPage();
      doc.setFontSize(14);
      doc.setTextColor(37, 99, 235);
      doc.text(`${config.icon} ${config.title}`, 14, 15);
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text(`班级：${CLASS_INFO.fullName}`, 14, 22);

      if (config.type === 'schedule') {
        this.buildPDFSchedule(doc, moduleId);
      } else {
        this.buildPDFTable(doc, moduleId);
      }
    });

    const fileName = `班委工作台_全部数据_${this.getDateString()}.pdf`;
    doc.save(fileName);
    Store.addFile({ name: fileName, module: 'all', moduleTitle: '全部模块', type: 'pdf', label: 'PDF', icon: '📄', recordCount: -1 });
    App.toast('📄 全部数据PDF导出成功', 'success');
  },

  buildPDFTable(doc, moduleId, recordIds) {
    const config = MODULE_CONFIG[moduleId];
    let data = Store.get(moduleId);
    if (recordIds && recordIds.length > 0) {
      data = data.filter(r => recordIds.includes(r.id));
    }
    const fields = config.fields;

    const headers = fields.map(f => f.label);
    const rows = data.map(record => {
      return fields.map(f => {
        const val = record[f.name];
        return val !== undefined && val !== null ? String(val) : '';
      });
    });

    doc.autoTable({
      startY: 30,
      head: [headers],
      body: rows.length > 0 ? rows : [fields.map(() => '')],
      theme: 'grid',
      headStyles: {
        fillColor: [37, 99, 235],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center'
      },
      bodyStyles: {
        fontSize: 9,
        cellPadding: 3
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252]
      },
      margin: { top: 30, left: 10, right: 10 }
    });
  },

  buildPDFSchedule(doc, moduleId) {
    const config = MODULE_CONFIG[moduleId];
    const scheduleData = Store.getSchedule();
    const days = config.days;
    const periods = config.periods;

    const headers = ['时间段', ...days];
    const rows = periods.map((period, pi) => {
      const row = [`${period.name}\n${period.time}`];
      days.forEach((day, di) => {
        const cell = scheduleData[`${pi}-${di}`];
        row.push(cell ? `${cell.subject}\n${cell.teacher}\n${cell.location}` : '');
      });
      return row;
    });

    doc.autoTable({
      startY: 30,
      head: [headers],
      body: rows,
      theme: 'grid',
      headStyles: {
        fillColor: [37, 99, 235],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center'
      },
      bodyStyles: {
        fontSize: 8,
        cellPadding: 2,
        valign: 'middle',
        halign: 'center'
      },
      margin: { top: 30, left: 10, right: 10 }
    });
  },

  // ============================
  //  PPT 导出 (pptxgenjs)
  // ============================

  exportPPT(moduleId, recordIds, skipRecord, openMode) {
    const config = MODULE_CONFIG[moduleId];
    if (!config) return;

    const pptx = new PptxGenJS();
    pptx.author = '班委工作台';
    pptx.title = config.title;

    const slide = pptx.addSlide();
    slide.addText(config.title, { x: 0.5, y: 0.3, w: '90%', h: 0.8, fontSize: 24, color: '2563eb', bold: true, align: 'center' });
    const info = `班级：${CLASS_INFO.fullName}    导出时间：${this.getFullDateString()}${recordIds ? '    记录数：' + recordIds.length + ' 条' : ''}`;
    slide.addText(info, { x: 0.5, y: 1.1, w: '90%', h: 0.4, fontSize: 11, color: '94a3b8', align: 'center' });

    if (config.type === 'schedule') {
      this.buildPPTSchedule(slide, moduleId);
    } else {
      this.buildPPTTable(slide, moduleId, recordIds);
    }

    const suffix = recordIds ? `_单条记录_${this.getDateString()}` : `_${this.getDateString()}`;
    const fileName = `${config.title}${suffix}.pptx`;

    if (openMode) {
      pptx.write({ outputType: 'blob' }).then(blob => {
        this.openBlob(blob, fileName, 'ppt');
        App.toast(`📽️ 正在打开 ${config.title} PPT...`, 'success');
      });
    } else {
      pptx.writeFile({ fileName });
      if (!skipRecord) this.recordFile(moduleId, config, 'ppt', fileName);
      App.toast(`📽️ ${config.title} PPT导出成功`, 'success');
    }
  },

  exportAllPPT() {
    const pptx = new PptxGenJS();
    pptx.author = '班委工作台';
    pptx.title = '班委工作台 - 全部数据';

    // 封面
    const coverSlide = pptx.addSlide();
    coverSlide.addText('班委工作台', { x: 0.5, y: 1.5, w: '90%', h: 1.2, fontSize: 36, color: '2563eb', bold: true, align: 'center' });
    coverSlide.addText('全部数据导出', { x: 0.5, y: 2.7, w: '90%', h: 0.6, fontSize: 20, color: '64748b', align: 'center' });
    coverSlide.addText(`班级：${CLASS_INFO.fullName}    导出时间：${this.getFullDateString()}`, { x: 0.5, y: 3.5, w: '90%', h: 0.4, fontSize: 12, color: '94a3b8', align: 'center' });

    Object.keys(MODULE_CONFIG).forEach(moduleId => {
      const config = MODULE_CONFIG[moduleId];
      const slide = pptx.addSlide();
      slide.addText(`${config.icon} ${config.title}`, { x: 0.5, y: 0.3, w: '90%', h: 0.6, fontSize: 20, color: '2563eb', bold: true });
      slide.addText(`班级：${CLASS_INFO.fullName}`, { x: 0.5, y: 0.9, w: '90%', h: 0.3, fontSize: 10, color: '94a3b8' });

      if (config.type === 'schedule') {
        this.buildPPTSchedule(slide, moduleId);
      } else {
        this.buildPPTTable(slide, moduleId);
      }
    });

    const fileName = `班委工作台_全部数据_${this.getDateString()}.pptx`;
    pptx.writeFile({ fileName });
    Store.addFile({ name: fileName, module: 'all', moduleTitle: '全部模块', type: 'ppt', label: 'PPT', icon: '📽️', recordCount: -1 });
    App.toast('📽️ 全部数据PPT导出成功', 'success');
  },

  buildPPTTable(slide, moduleId, recordIds) {
    const config = MODULE_CONFIG[moduleId];
    let data = Store.get(moduleId);
    if (recordIds && recordIds.length > 0) {
      data = data.filter(r => recordIds.includes(r.id));
    }
    const fields = config.fields;

    const headers = fields.map(f => ({ text: f.label, options: { bold: true, color: 'FFFFFF', fill: '2563eb', align: 'center', fontSize: 10 } }));
    const rows = data.map(record => {
      return fields.map(f => {
        const val = record[f.name];
        return { text: val !== undefined && val !== null ? String(val) : '', options: { fontSize: 9 } };
      });
    });

    if (rows.length === 0) {
      rows.push(fields.map(() => ({ text: '暂无数据', options: { fontSize: 9, color: 'CBD5E1' } })));
    }

    slide.addTable([headers, ...rows], {
      x: 0.3, y: 1.3, w: '94%',
      border: { type: 'solid', color: 'E2E8F0' },
      rowH: 0.5,
      autoPage: true
    });
  },

  buildPPTSchedule(slide, moduleId) {
    const config = MODULE_CONFIG[moduleId];
    const scheduleData = Store.getSchedule();
    const days = config.days;
    const periods = config.periods;

    const headers = [{ text: '时间段', options: { bold: true, color: 'FFFFFF', fill: '2563eb', align: 'center', fontSize: 10 } }];
    days.forEach(d => { headers.push({ text: d, options: { bold: true, color: 'FFFFFF', fill: '2563eb', align: 'center', fontSize: 10 } }); });

    const rows = periods.map((period, pi) => {
      const row = [{ text: `${period.name}\n${period.time}`, options: { fontSize: 8, bold: true, align: 'center' } }];
      days.forEach((day, di) => {
        const cell = scheduleData[`${pi}-${di}`];
        const txt = cell ? `${cell.subject}\n${cell.teacher}\n${cell.location}` : '';
        row.push({ text: txt, options: { fontSize: 7, align: 'center' } });
      });
      return row;
    });

    slide.addTable([headers, ...rows], {
      x: 0.3, y: 1.3, w: '94%',
      border: { type: 'solid', color: 'E2E8F0' },
      rowH: 0.8,
      autoPage: true
    });
  },

  // ============================
  //  导入 Excel
  // ============================

  importExcel(moduleId, file, label) {
    return new Promise((resolve, reject) => {
      const config = MODULE_CONFIG[moduleId];
      if (!config) { reject(new Error('模块不存在')); return; }

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const ext = file.name.split('.').pop().toLowerCase();
          let wb;
          if (ext === 'csv') {
            // CSV 文件必须先用 UTF-8 解码，否则中文表头会乱码导致字段映射失败
            const text = new TextDecoder('utf-8').decode(e.target.result);
            wb = XLSX.read(text, { type: 'string' });
          } else {
            const data = new Uint8Array(e.target.result);
            wb = XLSX.read(data, { type: 'array' });
          }
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(ws, { defval: '' });

        if (config.type === 'schedule') {
          this.importScheduleFromSheet(ws, moduleId);
        } else if (moduleId === 'weekend') {
          // 去向登记表：双栏并排、表头在第3行，专用解析
          this.importWeekendFromSheet(ws, moduleId, label);
        } else if (moduleId === 'leave') {
          // 请假统计表：标准单栏表，专用解析
          this.importLeaveFromSheet(ws, moduleId, label);
        } else if (moduleId === 'absence') {
          // 缺勤统计表：标准单栏表，专用解析
          this.importAbsenceFromSheet(ws, moduleId, label);
        } else {
          // 预处理 row：去除 key 的 BOM、空格，建立规范化映射
          const normalizeKey = (k) => String(k || '').replace(/^\uFEFF/, '').trim();
          const records = json.map(row => {
            const record = { id: 'imp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) };
            // 建立规范化的 row 映射
            const normRow = {};
            Object.keys(row).forEach(k => { normRow[normalizeKey(k)] = row[k]; });
            config.fields.forEach(f => {
              // 依次尝试：字段标签、字段名、常见别名
              let val = undefined;
              const candidates = [f.label, f.name];
              // 常见别名映射
              const aliases = {
                'name': ['姓名', '名字', '名称', '学生姓名'],
                'studentId': ['学号', '编号', '学生编号', 'ID'],
                'gender': ['性别', '男/女'],
                'dorm': ['宿舍', '寝室', '宿舍楼', '宿舍号'],
                'phone': ['联系电话', '电话', '手机', '手机号', '联系方式'],
                'position': ['班级职务', '职务', '职位', '班委职务'],
                'notes': ['备注', '说明', '其他', '补充']
              };
              if (aliases[f.name]) candidates.push(...aliases[f.name]);
              for (const key of candidates) {
                const nk = normalizeKey(key);
                if (normRow[nk] !== undefined) { val = normRow[nk]; break; }
              }
              record[f.name] = val !== undefined ? val : '';
            });
            return record;
          });

          // 过滤掉所有字段都为空的行（避免空行/双栏空白列被导入成一堆空记录）
          const validRecords = records.filter(r => {
            return Object.keys(r).some(k => {
              if (k === 'id') return false;
              const v = r[k];
              return v !== null && v !== undefined && String(v).trim() !== '';
            });
          });
          const skipped = records.length - validRecords.length;
          Store.save(moduleId, validRecords);
          App.renderTable(moduleId);
          App.toast(`📥 成功导入 ${validRecords.length} 条记录${skipped > 0 ? '（已自动跳过 ' + skipped + ' 条空行）' : ''}`, 'success');
        }
      } catch (err) {
        console.error('导入失败:', file.name, err);
        App.toast('导入失败：「' + file.name + '」请检查文件格式', 'error');
        reject(err);
        return;
      }
      resolve();
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsArrayBuffer(file);
    });
  },

  // ===== 周末去向登记表专用解析（双栏并排，表头在第3行） =====
  importWeekendFromSheet(ws, moduleId, label) {
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    // 表头列名（左栏0-7，右栏8-15）
    const headerNames = ['序号', '姓名', '去向', '目的地', '宿舍号', '电话', '离校日期'];
    const fieldMap = { '序号': 'index', '姓名': 'name', '去向': 'destination_type', '目的地': 'destination', '宿舍号': 'dorm', '电话': 'phone', '离校日期': 'leaveDate' };

    const records = [];
    const now = Date.now();
    let idCount = 0;

    const parseBlock = (colStart) => {
      // 定位表头行：从第1行（index 1，即Excel第2行）起找包含"姓名"的行
      let headerRow = -1;
      for (let i = 0; i < Math.min(aoa.length, 6); i++) {
        const row = aoa[i] || [];
        if (String(row[colStart + 1] || '').includes('姓名')) { headerRow = i; break; }
      }
      if (headerRow === -1) return;
      for (let r = headerRow + 1; r < aoa.length; r++) {
        const row = aoa[r] || [];
        const name = String(row[colStart + 1] || '').trim();
        if (!name || name === '姓名') continue; // 跳过空行
        const rec = { id: 'imp_' + now + '_' + (idCount++) + Math.random().toString(36).slice(2, 5) };
        headerNames.forEach((hn, hi) => {
          const v = row[colStart + hi];
          rec[fieldMap[hn]] = (v !== undefined && v !== null) ? String(v).trim() : '';
        });
        rec['week'] = label || '';
        rec['notes'] = '';
        // 只保留有姓名的有效记录
        if (rec.name) records.push(rec);
      }
    };

    parseBlock(0);   // 左栏
    parseBlock(8);   // 右栏（第9列起）

    // 按序号排序
    records.sort((a, b) => (parseInt(a.index) || 999) - (parseInt(b.index) || 999));

    if (records.length === 0) {
      App.toast('未识别到去向登记数据，请确认文件为机电一体化2503班去向登记表', 'error');
      return;
    }
    Store.save(moduleId, records);
    App.renderTable(moduleId);
    App.toast(`📥 成功导入 ${records.length} 条去向登记记录`, 'success');
  },

  // ===== 学生请假统计表专用解析（单栏，表头在第1行） =====
  importLeaveFromSheet(ws, moduleId, label) {
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (aoa.length < 2) { App.toast('请假表数据为空', 'error'); return; }

    // 字段映射：Excel表头 -> 记录字段
    const fieldMap = {
      '学号': 'studentId', '姓名': 'name', '学年度': 'schoolYear', '开课学期': 'semester',
      '审批时间': 'approveTime', '审批人': 'approver', '请假类型': 'leaveType',
      '请假开始时间': 'startDate', '请假结束时间': 'endDate', '请假提交类型': 'submitType',
      '请假原因': 'reason', '请假天数': 'days', '是否出校': 'outCampus',
      '是否销假': 'cancelled', '销假时间': 'cancelTime'
    };
    // 表头行索引（第1行，即 index 0），并建立 列号->字段 映射
    const headerRow = aoa[0] || [];
    const colField = {};
    headerRow.forEach((h, ci) => {
      // 请假表第3列表头是"2025-2024"这类学年度数字，按列号硬编码映射
      if (ci === 2) { colField[2] = 'schoolYear'; return; }
      const hn = String(h || '').replace(/\r?\n/g, '').trim();
      if (fieldMap[hn]) colField[ci] = fieldMap[hn];
    });

    const records = [];
    const now = Date.now();
    let idCount = 0;
    for (let r = 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const rec = { id: 'imp_' + now + '_' + (idCount++) + Math.random().toString(36).slice(2, 5), month: label || '' };
      Object.keys(colField).forEach(ci => {
        const v = row[ci];
        rec[colField[ci]] = (v !== undefined && v !== null) ? String(v).trim() : '';
      });
      if (rec.name || rec.studentId) records.push(rec);
    }

    if (records.length === 0) { App.toast('未识别到请假数据', 'error'); return; }
    Store.save(moduleId, records);
    App.renderTable(moduleId);
    App.toast(`📥 成功导入 ${records.length} 条请假记录`, 'success');
  },

  // ===== 学生缺勤统计表专用解析（单栏，表头在第1行） =====
  importAbsenceFromSheet(ws, moduleId, label) {
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (aoa.length < 2) { App.toast('缺勤表数据为空', 'error'); return; }

    const fieldMap = {
      '学号': 'studentId', '姓名': 'name', '开课学年度': 'schoolYear', '开课学期码': 'semester',
      '审批时间': 'approveTime', '审批人': 'approver', '缺勤日期': 'absenceDate',
      '缺勤类型': 'absenceType', '考勤类型': 'attendType', '缺勤原因': 'reason'
    };
    const headerRow = aoa[0] || [];
    const colField = {};
    headerRow.forEach((h, ci) => {
      let hn = String(h || '').replace(/\r?\n/g, '').trim();
      // 处理表头中带括号说明的情况，如"缺勤类型(病假、事假...)"
      hn = hn.split('（')[0].split('(')[0].trim();
      if (fieldMap[hn]) colField[ci] = fieldMap[hn];
    });

    const records = [];
    const now = Date.now();
    let idCount = 0;
    for (let r = 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const rec = { id: 'imp_' + now + '_' + (idCount++) + Math.random().toString(36).slice(2, 5), month: label || '' };
      Object.keys(colField).forEach(ci => {
        const v = row[ci];
        rec[colField[ci]] = (v !== undefined && v !== null) ? String(v).trim() : '';
      });
      if (rec.name || rec.studentId) records.push(rec);
    }

    if (records.length === 0) { App.toast('未识别到缺勤数据', 'error'); return; }
    Store.save(moduleId, records);
    App.renderTable(moduleId);
    App.toast(`📥 成功导入 ${records.length} 条缺勤记录`, 'success');
  },

  importScheduleFromSheet(ws, moduleId) {
    const config = MODULE_CONFIG[moduleId];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const days = config.days; // ['周一', ..., '周日']
    const scheduleData = {};

    // 1. 定位表头行（包含"周一"~"周日"或"星期一"~"星期日"字样）
    let headerRow = -1;
    const dayAliases = {
      '一': 0, '二': 1, '三': 2, '四': 3, '五': 4, '六': 5, '日': 6
    };
    for (let i = 0; i < aoa.length; i++) {
      const row = aoa[i];
      if (!row) continue;
      const joined = row.map(c => String(c || '')).join(' ');
      let hit = 0;
      Object.keys(dayAliases).forEach(ch => {
        if (joined.includes('周' + ch) || joined.includes('星期' + ch)) hit++;
      });
      if (hit >= 3) { headerRow = i; break; }
    }
    if (headerRow === -1) headerRow = 0; // 兜底：默认第一行是表头

    // 2. 确定每个星期对应的列索引（在表头行中查找）
    const header = aoa[headerRow] || [];
    const dayCol = {}; // dayIndex -> colIndex
    days.forEach((day, di) => {
      const ch = day.replace('周', '');
      for (let j = 0; j < header.length; j++) {
        const h = String(header[j] || '').trim();
        if (h.includes('周' + ch) || h.includes('星期' + ch) || (h === ch && h.length === 1)) {
          dayCol[di] = j;
          break;
        }
      }
    });
    // 若未识别出任何星期列，按默认顺序（第1列起）映射
    if (Object.keys(dayCol).length === 0) {
      for (let di = 0; di < days.length; di++) dayCol[di] = di + 1;
    }

    // 3. 逐行解析节次与课程
    for (let i = headerRow + 1; i < aoa.length; i++) {
      const row = aoa[i];
      if (!row) continue;
      // 找节次名（"第X节"）
      let periodIndex = -1;
      for (let j = 0; j < row.length && j < 3; j++) {
        const m = String(row[j] || '').match(/第\s*(\d+)\s*节/);
        if (m) { periodIndex = parseInt(m[1]) - 1; break; }
      }
      if (periodIndex < 0 || periodIndex >= config.periods.length) continue;

      for (const [di, colIdx] of Object.entries(dayCol)) {
        const cellText = String(row[colIdx] || '').trim();
        if (cellText && !['—', '-', '／', '/', '无'].includes(cellText)) {
          const cell = this._parseScheduleCell(cellText);
          if (cell.subject) scheduleData[`${periodIndex}-${di}`] = cell;
        }
      }
    }

    if (Object.keys(scheduleData).length === 0) {
      App.toast('未识别出课表，请确认表格包含"周一~周日"和"第1节~第8节"', 'warning');
      return;
    }

    Store.saveSchedule(scheduleData);
    App.renderSchedule(moduleId);
    App.toast(`📥 成功导入 ${Object.keys(scheduleData).length} 节课`, 'success');
  },

  // 解析课表单元格文本 → { subject, teacher, location }
  _parseScheduleCell(text) {
    const cell = { subject: '', teacher: '', location: '' };
    const lines = String(text).split(/\n/).map(s => s.trim()).filter(s => s);
    if (lines.length === 0) return cell;

    // 多行格式：第一行课程名，其余行含"教师/教室"
    cell.subject = lines[0];
    lines.forEach(line => {
      if (line.includes('教师')) cell.teacher = line.replace(/教师[:：]\s*/, '').trim();
      if (line.includes('教室')) cell.location = line.replace(/教室[:：]\s*/, '').trim();
      if (line.includes('@')) cell.location = line.split('@').pop().trim() || cell.location;
    });

    // 单行格式
    if (lines.length === 1) {
      const line = lines[0];
      // "课程名@地点"
      if (line.includes('@')) {
        const parts = line.split('@');
        cell.subject = parts[0].trim();
        cell.location = parts[parts.length - 1].trim();
      }
      // "课程名 教师 教室"（以空格分隔，末段为教室、中段为人名）
      if (!cell.location) {
        const m = line.match(/^(.+?)\s+([\u4e00-\u9fa5]{2,4}(?:老师|教师|教授)?)\s+([\u4e00-\u9fa5A-Za-z0-9-]+)$/);
        if (m) {
          cell.subject = m[1].trim();
          cell.teacher = m[2].trim();
          cell.location = m[3].trim();
        }
      }
    }
    return cell;
  },

  // ============================
  //  课表图片识别（OCR）
  // ============================

  // 读取文件为 Data URL
  _readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  // 课表图片 → OCR → 聚类 → 返回候选课表数据 { 'periodIndex-dayIndex': {subject,teacher,location} }
  async recognizeScheduleImage(file) {
    if (typeof Tesseract === 'undefined') {
      App.toast('OCR 组件未加载，请刷新页面后重试', 'error');
      return null;
    }
    const config = MODULE_CONFIG.schedule;
    const days = config.days;

    try {
      const dataUrl = await this._readFileAsDataURL(file);
      const { data } = await Tesseract.recognize(dataUrl, 'chi_sim', {
        logger: m => {
          if (m.status === 'recognizing text') {
            App.toast('🔍 正在识别课表 ' + Math.round(m.progress * 100) + '%', 'info');
          }
        }
      });

      // 收集带位置的文字
      const words = data.words
        .map(w => ({
          text: (w.text || '').trim(),
          x: Math.round((w.bbox.x0 + w.bbox.x1) / 2),
          y: Math.round((w.bbox.y0 + w.bbox.y1) / 2),
          x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1
        }))
        .filter(w => w.text && /[\u4e00-\u9fa5A-Za-z0-9]/.test(w.text));

      const scheduleData = this._clusterScheduleWords(words, config, days);
      return scheduleData;
    } catch (err) {
      console.error('课表图片识别失败:', err);
      App.toast('课表图片识别失败，请换一张清晰的图片重试', 'error');
      return null;
    }
  },

  // OCR 文字 → 行列聚类 → 课表数据
  // v2：按表头"周X"定位列边界；按课程块顶部 y 映射节次（兼容大课占两小节）
  _clusterScheduleWords(words, config, days) {
    const scheduleData = {};
    const dayChars = { '一': 0, '二': 1, '三': 2, '四': 3, '五': 4, '六': 5, '日': 6 };
    const NAV_WORDS = ['首页', '消息', '我的', '课表', '备注', '长按', '格子', '添加', '空白', '教室', '找', '点', '无课', '月', '日', '周'];
    const NAV_HINTS = ['首页', '我的', '课表', '消息', '页', '消', '息', '表', '课', '的', '四'];

    // ---- 1. 识别表头"周一~周日"，确定列边界 ----
    const dayMarks = []; // {day, x, y}
    const weekChars = []; // 单独的"周"字
    words.forEach(w => {
      let m = w.text.match(/^周([一二三四五六日])$/);
      if (m) { dayMarks.push({ day: dayChars[m[1]], x: w.x, y: w.y }); return; }
      m = w.text.match(/^星期([一二三四五六日])$/);
      if (m) { dayMarks.push({ day: dayChars[m[1]], x: w.x, y: w.y }); return; }
      if (w.text === '周') weekChars.push({ x: w.x, y: w.y });
    });
    // OCR 常把"周一"拆成"周"+"一"，用"周"字按 x 排序推断 7 列（取 y 最集中的一行）
    if (dayMarks.length < 3 && weekChars.length >= 3) {
      let best = weekChars;
      if (weekChars.length > 7) {
        const ys = weekChars.slice().sort((a, b) => a.y - b.y);
        let bst = [], cur = [ys[0]];
        for (let i = 1; i < ys.length; i++) {
          if (ys[i].y - ys[i - 1].y <= 45) cur.push(ys[i]);
          else { if (cur.length > bst.length) bst = cur; cur = [ys[i]]; }
        }
        if (cur.length > bst.length) bst = cur;
        best = bst;
      }
      best.slice().sort((a, b) => a.x - b.x).slice(0, 7).forEach((w, i) => {
        dayMarks.push({ day: i, x: w.x, y: w.y });
      });
    }
    if (dayMarks.length < 3) return scheduleData; // 无法定位列

    const headerY = this._median(dayMarks.map(m => m.y));
    const xs = [];
    dayMarks.forEach(m => { if (xs[m.day] === undefined) xs[m.day] = m.x; });
    const known = Object.keys(xs).map(Number).sort((a, b) => a - b);
    if (known.length >= 2) {
      const step = (xs[known[known.length - 1]] - xs[known[0]]) / (known[known.length - 1] - known[0]);
      for (let d = 0; d < 7; d++) {
        if (xs[d] === undefined) {
          const ref = known.find(k => k < d);
          xs[d] = ref !== undefined ? xs[ref] + (d - ref) * step : xs[known[0]] - (known[0] - d) * step;
        }
      }
    }
    const colBounds = [];
    for (let d = 0; d < 7; d++) {
      const left = d === 0 ? -1 : (xs[d - 1] + xs[d]) / 2;
      const right = d === 6 ? Infinity : (xs[d] + xs[d + 1]) / 2;
      colBounds[d] = { left, right };
    }

    // ---- 2. 过滤课程文字 ----
    let courseWords = words.filter(w => {
      if (w.y < headerY + 25) return false;
      if (/^周[一二三四五六日]$/.test(w.text) || /^星期[一二三四五六日]$/.test(w.text)) return false;
      if (/^[一二三四五六日]$/.test(w.text) && w.y > headerY - 60 && w.y < headerY + 60) return false;
      if (/^\d{1,2}$/.test(w.text)) return false; // 日期数字
      if (/[<>|」『【】《》」,.·|]/.test(w.text)) return false;
      if (NAV_WORDS.includes(w.text)) return false;
      return true;
    });
    if (courseWords.length === 0) return scheduleData;

    // ---- 3. 排除底部导航栏（y 最大的一簇且含导航词） ----
    const byY = courseWords.slice().sort((a, b) => a.y - b.y);
    const navCluster = [byY[byY.length - 1]];
    for (let i = byY.length - 2; i >= 0; i--) {
      if (navCluster[navCluster.length - 1].y - byY[i].y < 130) navCluster.push(byY[i]);
      else break;
    }
    if (navCluster.some(w => NAV_HINTS.includes(w.text))) {
      courseWords = courseWords.filter(w => !navCluster.includes(w));
    }
    if (courseWords.length === 0) return scheduleData;

    // ---- 4. 计算每节高度 ----
    const maxBottom = Math.max(...courseWords.map(w => w.y));
    const periodH = Math.max(20, (maxBottom - headerY) / config.periods.length);
    const mergeTh = periodH * 0.25; // 聚类阈值：区分块内行距与块间隙

    // ---- 5. 按列分组 ----
    const colWords = [];
    for (let d = 0; d < 7; d++) colWords[d] = [];
    courseWords.forEach(w => {
      for (let d = 0; d < 7; d++) {
        if (w.x >= colBounds[d].left && w.x < colBounds[d].right) {
          colWords[d].push(w);
          return;
        }
      }
    });

    // ---- 6. 每列聚类成课程块并映射节次 ----
    for (let d = 0; d < 7; d++) {
      const cw = colWords[d].slice().sort((a, b) => a.y - b.y || a.x - b.x);
      if (cw.length === 0) continue;
      const blocks = []; // {y0, words}
      let cur = { y0: cw[0].y, words: [cw[0]] };
      for (let i = 1; i < cw.length; i++) {
        if (cw[i].y - cur.words[cur.words.length - 1].y <= mergeTh) {
          cur.words.push(cw[i]);
        } else {
          blocks.push(cur);
          cur = { y0: cw[i].y, words: [cw[i]] };
        }
      }
      blocks.push(cur);

      blocks.forEach(b => {
        // 块高度（用于判断是否为占两小节的大课）
        const blockH = b.words.length > 1 ? Math.max(...b.words.map(w => w.y)) - b.y0 : 0;
        let pi = Math.floor((b.y0 - headerY) / periodH);
        if (pi < 0) pi = 0;
        if (pi >= config.periods.length) pi = config.periods.length - 1;
        // 拼接块内文字：按 y 分行、行内按 x 排序
        const sorted = b.words.slice().sort((a, b2) => a.y - b2.y || a.x - b2.x);
        const lines = [];
        let curLine = [sorted[0]];
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i].y - sorted[i - 1].y > periodH * 0.16) {
            lines.push(curLine);
            curLine = [sorted[i]];
          } else {
            curLine.push(sorted[i]);
          }
        }
        lines.push(curLine);
        const text = lines.map(line => line.sort((a, b2) => a.x - b2.x).map(w => w.text).join('')).join(' ');
        const cell = this._parseScheduleOcrText(text);
        if (cell.subject && !scheduleData[`${pi}-${d}`]) {
          scheduleData[`${pi}-${d}`] = cell;
        }
        // 大课占两小节：块高超过 1.4 倍节高时，同时填入下一节
        if (blockH > periodH * 1.4 && pi + 1 < config.periods.length && !scheduleData[`${pi + 1}-${d}`]) {
          scheduleData[`${pi + 1}-${d}`] = JSON.parse(JSON.stringify(cell));
        }
      });
    }
    return scheduleData;
  },

  // 解析 OCR 识别出的课表文本（按 @ 或地点关键词分割课程名与地点）
  _parseScheduleOcrText(text) {
    const cell = { subject: '', teacher: '', location: '' };
    let clean = String(text).replace(/\s+/g, '');
    if (!clean) return cell;
    let subject = '', location = '';
    const atIdx = clean.indexOf('@');
    if (atIdx >= 0) {
      subject = clean.slice(0, atIdx);
      location = clean.slice(atIdx + 1);
    } else {
      // 无 @ 时，用地点关键词分割（OCR 可能把 @ 识别错）
      const kwMatch = clean.search(/校区|教学楼|学院楼|实训楼|综合楼|机房|教室|楼\d|楼$/);
      if (kwMatch > 0) {
        subject = clean.slice(0, kwMatch);
        location = clean.slice(kwMatch);
      } else {
        subject = clean;
      }
    }
    cell.subject = subject.replace(/[|‖【】\[\]「」@#*]/g, '').trim();
    cell.location = location.replace(/[|‖【】\[\]「」@#*]/g, '').trim();
    // 课程名里残留的误识别地点前缀（如 @港务 被识别成"图Q法务"）
    cell.subject = cell.subject.replace(/(图Q|Q法|法务|浆务|深务|港务|核区|校务|团I).*$/, '');
    // 地点重复片段去重（如"机电工程学院楼机电工程学院楼504"）
    if (cell.location) {
      for (let rep = 1; rep <= 2; rep++) {
        cell.location = cell.location.replace(new RegExp('(.{' + (6 - rep) + ',10})\\1', 'g'), '$1');
      }
      cell.location = cell.location.replace(/^(校区|港务校区)/, '');
      if (cell.location.length > 40) cell.location = cell.location.slice(0, 40);
    }
    return cell;
    return cell;
  },

  // 中位数
  _median(arr) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  },

  // ============================
  //  备份/恢复
  // ============================

  exportBackup() {
    const data = Store.exportAll();
    const json = JSON.stringify(data, null, 2);
    const fileName = `班委工作台_备份_${this.getDateString()}.json`;
    this.downloadFile(fileName, json, 'application/json');
    App.toast('💾 数据备份导出成功', 'success');
  },

  importBackup(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (Store.importAll(data)) {
            App.toast('💾 数据恢复成功', 'success');
            App.renderModule(App.currentModule);
            resolve();
          } else {
            App.toast('数据格式错误', 'error');
            reject(new Error('数据格式错误'));
          }
        } catch (err) {
          console.error('备份文件解析失败:', file.name, err);
          App.toast('文件解析失败：「' + file.name + '」不是有效的备份JSON', 'error');
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsText(file);
    });
  },

  // 导入 Word（docx）文件：用 mammoth 解析内容，自动创建记录并保存原文件附件
  async importWord(moduleId, file) {
    const config = MODULE_CONFIG[moduleId];
    if (!config) return;

    try {
      App.toast('正在解析 Word 文件...', 'info');

      // 调用 DocxParser 解析（mammoth 提取纯文本 + 各模块字段映射）
      const result = await DocxParser.parseDocx(moduleId, file);
      const records = result.records || [];

      if (records.length === 0) {
        App.toast('未从文件中识别到有效内容', 'warning');
        return;
      }

      // 给每条记录补 id，并关联原始文件（用于眼睛在线预览 + 导出原文件）
      let savedFileId = null;
      if (result.originalFileBase64) {
        const savedFile = Store.addFile({
          name: result.originalFileName,
          module: moduleId,
          moduleTitle: config.title,
          type: 'word',
          label: 'Word 文档',
          icon: '📄',
          recordCount: records.length,
          isAttachment: true,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          content: result.originalFileBase64,
          size: file.size
        });
        savedFileId = savedFile.id;
      }

      records.forEach(rec => {
        if (!rec.id) rec.id = 'imp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        if (savedFileId) rec.sourceFile = { fileId: savedFileId };
      });

      // 追加保存到模块（不覆盖已有数据）
      const existing = Store.get(moduleId) || [];
      Store.save(moduleId, [...existing, ...records]);

      App.renderTable(moduleId);
      App.toast(`📥 成功导入 ${records.length} 条记录`, 'success');
    } catch (err) {
      console.error('Word 导入失败:', err);
      App.toast('Word 文件解析失败：' + (err.message || '未知错误'), 'error');
    }
  },

  // 将非 Excel 文件作为附件保存到文件中心
  // v50：返回 Promise，异步失败 reject（批量导入能精确统计失败文件）
  importAsAttachment(moduleId, file, format, label) {
    return new Promise((resolve, reject) => {
      const config = MODULE_CONFIG[moduleId] || (moduleId === '_files' ? { title: '文件中心' } : null);
      const fmt = FILE_FORMATS.find(f => f.id === format);
      if (!config || !fmt) { reject(new Error('模块或格式不存在')); return; }

      // 不限制文件大小（用户要求），仅提示大文件处理较慢
      if (file.size > 20 * 1024 * 1024) {
        App.toast('文件较大（' + (file.size/1024/1024).toFixed(1) + 'MB），正在保存，请稍候...', 'warning');
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const base64 = e.target.result.split(',')[1];
          const mimeType = e.target.result.split(',')[0].split(':')[1].split(';')[0];
          // 考勤模块：导入时填写的周次/月份自动标注到文件名（不修改原文件内容）
          let saveName = file.name;
          if (label) {
            const clean = String(label).replace(/[\\/:*?"<>|]/g, '').trim();
            if (clean) saveName = '【' + clean + '】' + saveName;
          }
          Store.addFile({
            name: saveName,
            module: moduleId,
            moduleTitle: config.title,
            type: format,
            label: fmt.label,
            icon: fmt.icon,
            recordCount: 0,
            isAttachment: true,
            mimeType: mimeType,
            content: base64,
            size: file.size
          });
          App.toast(`${fmt.label} 文件已保存${label ? '（' + label + '）' : ''}`, 'success');
          if (App.currentModule) App.renderModule(App.currentModule);
          resolve();
        } catch (err) {
          console.error('附件保存失败:', file.name, err);
          App.toast('文件保存失败：「' + file.name + '」' + (err && err.message ? '：' + err.message : ''), 'error');
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
  },

  // ============================
  //  辅助方法
  // ============================

  // 直接打开 Blob，优先用 window.open / iframe，浏览器会调用系统默认程序打开
  // 关键点：用 download 属性保留原文件名，避免浏览器把 blob URL 当成"未命名下载"
  openBlob(blob, fileName, format) {
    // 根据扩展名使用正确的 MIME 类型
    const ext = fileName.split('.').pop().toLowerCase();
    const mimeByExt = {
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      xls: 'application/vnd.ms-excel',
      csv: 'text/csv',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      doc: 'application/msword',
      pdf: 'application/pdf',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ppt: 'application/vnd.ms-powerpoint'
    };
    const mime = mimeByExt[ext] || blob.type || 'application/octet-stream';
    const fileBlob = new Blob([blob], { type: mime });
    const url = URL.createObjectURL(fileBlob);

    if (ext === 'pdf') {
      // PDF 直接在浏览器新标签页预览
      const win = window.open(url, '_blank');
      if (!win || win.closed || typeof win.closed === 'undefined') {
        this.fallbackOpen(url, fileName);
      }
    } else {
      // Office 文件（docx/xlsx/pptx）：用 window.open 触发浏览器调用系统关联程序
      // 关键：不设 download 属性 → 浏览器根据 MIME 类型决定行为
      // 已装 WPS/Office → 直接用关联程序打开；未装 → 弹出"如何处理"对话框
      const win = window.open(url, '_blank');
      if (!win || win.closed || typeof win.closed === 'undefined') {
        // 弹窗被拦截兜底：不带 download 的 a 标签
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      App.toast('✅ 系统将自动调用 WPS / Office 打开', 'success');
    }

    // 预留较长时间再释放，保证办公软件能读取
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },

  // 打开文件中心已有的附件（静态资源或 base64 附件）
  openAttachment(fileInfo) {
    if (fileInfo.assetUrl) {
      // 静态资源文件：直接调用后端用系统默认应用打开
      this.openAssetFile(fileInfo.assetUrl, fileInfo.name);
      return;
    }
    if (fileInfo.isAttachment && fileInfo.content) {
      // base64 附件：纯前端在线预览（docx / xlsx / pdf / 图片），无需下载
      this.previewBase64Content(fileInfo.content, fileInfo.name);
      return;
    }
    if (fileInfo.cloudLimited) {
      // 云端无内容：该文件内容只存在于原上传设备（本设备 IndexedDB 里没有）
      // 3 秒内同一个文件不重复提示，避免用户双击卡片时弹出两次
      const now = Date.now();
      const id = fileInfo.id || fileInfo.name || 'unknown';
      if (this._cloudLimitedToastAt[id] && now - this._cloudLimitedToastAt[id] < 3000) return;
      this._cloudLimitedToastAt[id] = now;
      App.toast('⚠️ 该文件内容还没同步到云端，本设备无法打开。请在原上传设备打开网站联网停留十几秒自动补传，或重新上传一次', 'warning');
      return;
    }
    // 否则重新导出
    if (fileInfo.module === 'all') {
      this.exportAllFiles(fileInfo.type);
    } else {
      this.exportFile(fileInfo.module, fileInfo.type, { openMode: true });
    }
  },

  // 通过后端 /api/launch 直接打开静态资源文件
  openAssetFile(assetUrl, fileName) {
    App.toast('📄 正在打开原始文件...', 'info');
    fetch('/api/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ path: assetUrl })
    })
      .then(res => res.json())
      .then(data => {
        if (!data.success) throw new Error(data.error);
        App.toast('✅ 已调用系统默认应用打开文件', 'success');
      })
      .catch(err => {
        console.warn('后端启动失败，使用在线预览 fallback：', err);
        this.previewDocument(assetUrl, fileName);
      });
  },

  fallbackOpen(url, fileName) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  downloadFile(fileName, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    this.downloadBlob(blob, fileName);
  },

  getDateString() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  },

  getFullDateString() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }
};
