/* ============================================
   班委工作台 - 模块配置 & 示例数据
   ============================================ */

// ===== 班级信息 =====
const CLASS_INFO = {
  grade: '2025级',
  name: '机电一体化技术2503班',
  fullName: '2025级机电一体化技术2503班'
};

// ===== 支持的文件格式 =====
const FILE_FORMATS = [
  { id: 'excel', label: 'Excel', icon: '📊', ext: '.xlsx', color: '#10b981' },
  { id: 'word', label: 'Word', icon: '📝', ext: '.doc', color: '#6366f1' },
  { id: 'pdf', label: 'PDF', icon: '📄', ext: '.pdf', color: '#ef4444' },
  { id: 'ppt', label: 'PPT', icon: '📽️', ext: '.pptx', color: '#f59e0b' }
];

// ===== 导航分组配置 =====
const NAV_GROUPS = [
  {
    title: '概览',
    items: [
      { id: 'dashboard', icon: '📊', label: '工作台首页' }
    ]
  },
  {
    title: '日常工作',
    items: [
      { id: 'schedule', icon: '📅', label: '课表安排' },
      { id: 'students', icon: '👥', label: '学生情况' },
      { id: 'duty', icon: '🧹', label: '班级值日表' }
    ]
  },
  {
    title: '分析排查',
    items: [
      { id: 'weekly', icon: '📈', label: '周分析' },
      { id: 'monthly', icon: '🔍', label: '月排查' }
    ]
  },
  {
    title: '学生工作',
    items: [
      { id: 'talk', icon: '💬', label: '谈心谈话' },
      { id: 'friendship', icon: '🤝', label: '四进两联一交友' },
      { id: 'meeting', icon: '🎤', label: '主题班会' },
      { id: 'activity', icon: '⚽', label: '文体活动' },
      { id: 'leader', icon: '🎓', label: '学生干部培养' }
    ]
  },
  {
    title: '考勤管理',
    items: [
      { id: 'weekend', icon: '🏠', label: '周末去向登记' },
      { id: 'leave', icon: '📝', label: '学生请假' },
      { id: 'absence', icon: '❗', label: '学生缺勤' }
    ]
  },
  {
    title: '文件管理',
    items: [
      { id: 'files', icon: '📁', label: '文件中心' },
      { id: 'settings', icon: '⚙️', label: '设置' }
    ]
  }
];

// ===== 模块配置 =====
const MODULE_CONFIG = {

  // ----- 课表安排 (特殊网格类型) -----
  schedule: {
    title: '课表安排',
    desc: '管理班级每周课程安排',
    icon: '📅',
    type: 'schedule',
    color: '#3b82f6',
    bg: '#eff6ff',
    periods: [
      { name: '第1节', time: '08:10-08:55' },
      { name: '第2节', time: '09:05-09:50' },
      { name: '第3节', time: '10:20-11:05' },
      { name: '第4节', time: '11:15-12:00' },
      { name: '第5节', time: '14:00-14:45' },
      { name: '第6节', time: '14:55-15:40' },
      { name: '第7节', time: '15:55-16:40' },
      { name: '第8节', time: '16:50-17:35' }
    ],
    days: ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
  },

  // ----- 学生情况 -----
  students: {
    title: '学生情况',
    desc: '管理班级学生基本信息',
    icon: '👥',
    type: 'table',
    color: '#10b981',
    bg: '#ecfdf5',
    fields: [
      { name: 'index', label: '序号', type: 'number', width: 60, required: true },
      { name: 'name', label: '姓名', type: 'text', width: 100, required: true },
      { name: 'studentId', label: '学号', type: 'text', width: 130 },
      { name: 'gender', label: '性别', type: 'select', options: ['男', '女'], width: 70 },
      { name: 'dorm', label: '宿舍', type: 'text', width: 100 },
      { name: 'phone', label: '联系电话', type: 'text', width: 130 },
      { name: 'position', label: '班级职务', type: 'text', width: 100 },
      { name: 'notes', label: '备注', type: 'textarea', width: 180 }
    ]
  },

  // ----- 班级值日表 -----
  duty: {
    title: '班级值日表',
    desc: '管理班级卫生值日安排',
    icon: '🧹',
    type: 'table',
    color: '#f59e0b',
    bg: '#fffbeb',
    fields: [
      { name: 'date', label: '日期', type: 'date', width: 120, required: true },
      { name: 'weekday', label: '星期', type: 'select', options: ['周一','周二','周三','周四','周五','周六','周日'], width: 80 },
      { name: 'leader', label: '值日组长', type: 'text', width: 100 },
      { name: 'members', label: '值日成员', type: 'text', width: 200 },
      { name: 'area', label: '值日区域', type: 'text', width: 150 },
      { name: 'task', label: '值日任务', type: 'textarea', width: 200 },
      { name: 'status', label: '完成情况', type: 'select', options: ['已完成','进行中','未完成'], width: 100 }
    ]
  },

  // ----- 周分析 -----
  weekly: {
    title: '周分析',
    desc: '每周班级情况分析报告',
    icon: '📈',
    type: 'table',
    color: '#6366f1',
    bg: '#eef2ff',
    fields: [
      { name: 'weekNum', label: '周次', type: 'text', width: 80, required: true },
      { name: 'dateRange', label: '日期范围', type: 'text', width: 150 },
      { name: 'study', label: '学习情况', type: 'textarea', width: 250 },
      { name: 'discipline', label: '纪律情况', type: 'textarea', width: 250 },
      { name: 'hygiene', label: '卫生情况', type: 'textarea', width: 200 },
      { name: 'issues', label: '存在问题', type: 'textarea', width: 250 },
      { name: 'measures', label: '改进措施', type: 'textarea', width: 250 }
    ],
    tableFields: ['weekNum', 'dateRange']
  },

  // ----- 月排查 -----
  monthly: {
    title: '月排查',
    desc: '每月安全与情况排查记录',
    icon: '🔍',
    type: 'table',
    color: '#ef4444',
    bg: '#fef2f2',
    fields: [
      { name: 'month', label: '月份', type: 'text', width: 80, required: true },
      { name: 'item', label: '排查项目', type: 'text', width: 150, required: true },
      { name: 'content', label: '排查内容', type: 'textarea', width: 250 },
      { name: 'findings', label: '发现问题', type: 'textarea', width: 250 },
      { name: 'measures', label: '处理措施', type: 'textarea', width: 250 },
      { name: 'responsible', label: '责任人', type: 'text', width: 100 },
      { name: 'status', label: '状态', type: 'select', options: ['已整改','整改中','待整改'], width: 100 }
    ],
    tableFields: ['month', 'item']
  },

  // ----- 谈心谈话 -----
  talk: {
    title: '谈心谈话',
    desc: '记录与学生谈心谈话情况',
    icon: '💬',
    type: 'table',
    color: '#8b5cf6',
    bg: '#f5f3ff',
    fields: [
      { name: 'date', label: '日期', type: 'date', width: 120, required: true },
      { name: 'studentName', label: '学生姓名', type: 'text', width: 100, required: true },
      { name: 'topic', label: '谈话主题', type: 'text', width: 150 },
      { name: 'content', label: '谈话内容', type: 'textarea', width: 300 },
      { name: 'studentState', label: '学生状态', type: 'select', options: ['良好','一般','需关注','需干预'], width: 100 },
      { name: 'followUp', label: '后续跟进', type: 'textarea', width: 250 }
    ]
  },

  // ----- 四进两联一交友 -----
  friendship: {
    title: '四进两联一交友',
    desc: '进班级、进宿舍、进网络、进食堂；联系学生、联系家长；交一名学生朋友',
    icon: '🤝',
    type: 'table',
    color: '#06b6d4',
    bg: '#ecfeff',
    fields: [
      { name: 'date', label: '日期', type: 'date', width: 120, required: true },
      { name: 'activityType', label: '活动类型', type: 'select', options: ['进班级','进宿舍','进网络','进食堂','联系学生','联系家长','交友活动'], width: 120 },
      { name: 'participants', label: '参与人员', type: 'text', width: 180 },
      { name: 'content', label: '活动内容', type: 'textarea', width: 300 },
      { name: 'effect', label: '活动效果', type: 'textarea', width: 250 },
      { name: 'notes', label: '备注', type: 'textarea', width: 180 }
    ]
  },

  // ----- 主题班会 -----
  meeting: {
    title: '主题班会',
    desc: '主题班会活动记录',
    icon: '🎤',
    type: 'table',
    color: '#ec4899',
    bg: '#fdf2f8',
    fields: [
      { name: 'date', label: '日期', type: 'date', width: 120, required: true },
      { name: 'theme', label: '班会主题', type: 'text', width: 180, required: true },
      { name: 'host', label: '主持人', type: 'text', width: 100 },
      { name: 'attendees', label: '参加人数', type: 'number', width: 90 },
      { name: 'content', label: '班会内容', type: 'textarea', width: 300 },
      { name: 'effect', label: '班会效果', type: 'textarea', width: 250 },
      { name: 'status', label: '状态', type: 'select', options: ['已开展','计划中'], width: 90 }
    ],
    tableFields: ['date', 'theme']
  },

  // ----- 文体活动 -----
  activity: {
    title: '文体活动',
    desc: '文化体育活动记录',
    icon: '⚽',
    type: 'table',
    color: '#14b8a6',
    bg: '#f0fdfa',
    fields: [
      { name: 'date', label: '日期', type: 'date', width: 120, required: true },
      { name: 'name', label: '活动名称', type: 'text', width: 180, required: true },
      { name: 'type', label: '活动类型', type: 'select', options: ['体育竞赛','文艺演出','社团活动','户外拓展','其他'], width: 120 },
      { name: 'participants', label: '参与人数', type: 'number', width: 90 },
      { name: 'content', label: '活动内容', type: 'textarea', width: 300 },
      { name: 'result', label: '获奖情况', type: 'textarea', width: 200 },
      { name: 'notes', label: '备注', type: 'textarea', width: 150 }
    ],
    tableFields: ['date', 'name']
  },

  // ----- 学生干部培养 -----
  leader: {
    title: '学生干部培养',
    desc: '学生干部选拔与培养记录',
    icon: '🎓',
    type: 'table',
    color: '#f97316',
    bg: '#fff7ed',
    fields: [
      { name: 'date', label: '日期', type: 'date', width: 120, required: true },
      { name: 'studentName', label: '学生姓名', type: 'text', width: 100, required: true },
      { name: 'position', label: '职务', type: 'select', options: ['班长','副班长','团支书','学习委员','生活委员','文体委员','宣传委员','组织委员','心理委员'], width: 110 },
      { name: 'training', label: '培养内容', type: 'textarea', width: 250 },
      { name: 'method', label: '培养方式', type: 'select', options: ['一对一指导','集中培训','实践锻炼','观摩学习'], width: 120 },
      { name: 'progress', label: '进展情况', type: 'textarea', width: 250 },
      { name: 'notes', label: '备注', type: 'textarea', width: 150 }
    ]
  },

  // ----- 周末去向登记 -----
  weekend: {
    title: '周末去向登记',
    desc: '上传一个文件即为一个文件，导入时填写周次，文件名自动标注',
    icon: '🏠',
    type: 'file',
    color: '#0ea5e9',
    bg: '#f0f9ff'
  },

  // ----- 学生请假 -----
  leave: {
    title: '学生请假',
    desc: '上传一个文件即为一个文件，导入时填写月份，文件名自动标注',
    icon: '📝',
    type: 'file',
    color: '#8b5cf6',
    bg: '#f5f3ff'
  },

  // ----- 学生缺勤 -----
  absence: {
    title: '学生缺勤',
    desc: '上传一个文件即为一个文件，导入时填写月份，文件名自动标注',
    icon: '❗',
    type: 'file',
    color: '#ef4444',
    bg: '#fef2f2'
  }
};

// ===== 示例数据 =====
const SAMPLE_DATA = {};

const SAMPLE_FILES = [];
