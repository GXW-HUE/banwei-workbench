/* ============================================
   纯前端 Word 解析模块 (替代 parse_docx.py)
   使用 mammoth.js 提取文本后正则解析
   ============================================ */

const DocxParser = {
  // 中文月份映射
  CN_MONTHS: {
    '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,
    '七':7,'八':8,'九':9,'十':10,'十一':11,'十二':12,
    '1':1,'2':2,'3':3,'4':4,'5':5,'6':6,
    '7':7,'8':8,'9':9,'10':10,'11':11,'12':12
  },

  // 从文件名提取周次
  extractWeekNum(fileName) {
    let m = fileName.match(/第\s*(\d+)\s*周/);
    if (m) return '第' + m[1] + '周';
    m = fileName.match(/(\d+)\s*周/);
    if (m) return '第' + m[1] + '周';
    return '';
  },

  // 从文本提取月份
  extractMonth(text) {
    if (!text) return '';
    let m = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
    if (m) return m[1] + '年' + parseInt(m[2]) + '月';
    m = text.match(/(\d{1,2})\s*月/);
    if (m) return parseInt(m[1]) + '月';
    m = text.match(/([一二三四五六七八九十]+)\s*月/);
    if (m) {
      let n = this.CN_MONTHS[m[1]];
      if (n) return n + '月';
    }
    return '';
  },

  // 从文件名提取月份
  extractMonthFromFileName(fileName) {
    if (!fileName) return '';
    let m = fileName.match(/(\d{1,2})\s*月/);
    if (m) return parseInt(m[1]) + '月';
    m = fileName.match(/([一二三四五六七八九十]+)\s*月/);
    if (m) {
      let n = this.CN_MONTHS[m[1]];
      if (n) return n + '月';
    }
    return '';
  },

  // 清理文件名
  cleanFileName(fileName) {
    if (!fileName) return '';
    let name = fileName.replace(/\.(docx|doc)$/i, '');
    name = name.replace(/^(.*班)/, '');
    name = name.replace(/月排查.*$/, '月排查');
    return name.trim() || fileName;
  },

  // 从文本提取日期
  findDate(text) {
    if (!text) return '';
    const patterns = [
      /(\d{4})\s*[年/\-]\s*(\d{1,2})\s*[月/\-]\s*(\d{1,2})\s*日?/,
      /(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/
    ];
    for (let p of patterns) {
      let m = text.match(p);
      if (m) {
        return m[1] + '-' + String(m[2]).padStart(2,'0') + '-' + String(m[3]).padStart(2,'0');
      }
    }
    return '';
  },

  // 从文本提取学生姓名
  extractStudentName(text) {
    let m = text.match(/被谈话人[：:]\s*[^\n]*?\s+([\u4e00-\u9fa5]{2,4})(?:\s|$)/);
    if (m) return m[1];
    m = text.match(/(?:谈话对象|学生姓名|姓名)[：:]\s*([\u4e00-\u9fa5]{2,4})/);
    if (m) return m[1];
    return '';
  },

  // ===== 各模块解析器 =====

  parseWeekly(text, fileName) {
    let weekNum = this.extractWeekNum(fileName || '') || this.extractWeekNum(text);
    return [{
      weekNum: weekNum,
      dateRange: '',
      study: '',
      discipline: '',
      hygiene: '',
      issues: '',
      measures: text
    }];
  },

  parseMonthly(text, fileName) {
    let monthVal = this.extractMonthFromFileName(fileName) || this.extractMonth(text);
    let itemVal = this.cleanFileName(fileName);
    return [{
      month: monthVal || '',
      item: itemVal || '',
      content: '',
      findings: '',
      measures: '',
      responsible: '',
      status: '已整改'
    }];
  },

  parseMeeting(text, fileName) {
    let date = this.findDate(text) || new Date().toISOString().slice(0,10);
    return [{
      date: date,
      theme: fileName || '',
      host: '',
      attendees: '',
      content: text,
      effect: '',
      status: '已开展'
    }];
  },

  parseActivity(text, fileName) {
    let date = this.findDate(text) || new Date().toISOString().slice(0,10);
    let type = '';
    let typeKeywords = ['体育竞赛','文艺演出','社团活动','户外拓展'];
    for (let kw of typeKeywords) {
      if (text.includes(kw)) { type = kw; break; }
    }
    return [{
      date: date,
      name: fileName || '',
      type: type,
      participants: '',
      content: text,
      result: '',
      notes: ''
    }];
  },

  parseTalk(text, fileName) {
    let date = this.findDate(text) || new Date().toISOString().slice(0,10);
    let studentName = this.extractStudentName(text);
    let topic = '';
    let lines = text.split('\n').filter(l => l.trim());
    if (lines.length > 0) topic = lines[0];
    return [{
      date: date,
      studentName: studentName,
      topic: topic,
      content: text,
      studentState: '',
      followUp: ''
    }];
  },

  parseFriendship(text, fileName) {
    let date = this.findDate(text) || new Date().toISOString().slice(0,10);
    let activityType = '';
    let typeKeywords = ['进班级','进宿舍','进网络','进食堂','联系学生','联系家长','交友活动'];
    for (let kw of typeKeywords) {
      if (text.includes(kw)) { activityType = kw; break; }
    }
    return [{
      date: date,
      activityType: activityType,
      participants: '',
      content: text,
      effect: '',
      notes: ''
    }];
  },

  // ===== 主入口 =====
  // 使用 mammoth.js 提取文本后解析
  async parseDocx(moduleId, file) {
    if (typeof mammoth === 'undefined') {
      throw new Error('mammoth.js 未加载，请刷新页面后重试');
    }

    // 用 mammoth 读取 docx 为 ArrayBuffer 并提取纯文本
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    const text = result.value || '';

    // 保存原始文件内容为 base64（用于后续导出原文件）
    const base64Content = await this._arrayBufferToBase64(arrayBuffer);

    // 原始文件名（去掉扩展名）
    const originalFileName = file.name.replace(/\.(docx|doc)$/i, '');

    const parsers = {
      'weekly': () => this.parseWeekly(text, originalFileName),
      'monthly': () => this.parseMonthly(text, originalFileName),
      'meeting': () => this.parseMeeting(text, originalFileName),
      'activity': () => this.parseActivity(text, originalFileName),
      'talk': () => this.parseTalk(text, originalFileName),
      'friendship': () => this.parseFriendship(text, originalFileName),
    };

    if (!parsers[moduleId]) {
      throw new Error('不支持的模块: ' + moduleId);
    }

    let records = parsers[moduleId]();

    // 过滤空记录，给需要 date 字段的模块补日期
    let validRecords = [];
    let fallbackDate = new Date().toISOString().slice(0,10);
    for (let rec of records) {
      if (!Object.values(rec).some(v => v)) continue;
      if (['talk','friendship','meeting','activity'].includes(moduleId) && !rec.date) {
        rec.date = this.findDate(text) || fallbackDate;
      }
      validRecords.push(rec);
    }

    // 如果没有任何记录，创建一条兜底记录
    if (validRecords.length === 0) {
      validRecords.push({
        date: fallbackDate,
        content: text,
        parseError: '未识别到有效内容'
      });
    }

    return {
      records: validRecords,
      originalFileBase64: base64Content,
      originalFileName: file.name
    };
  },

  // ArrayBuffer 转 base64
  async _arrayBufferToBase64(arrayBuffer) {
    const blob = new Blob([arrayBuffer]);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const base64 = dataUrl.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
};
