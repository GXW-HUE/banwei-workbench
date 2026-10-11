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
const SAMPLE_DATA = {
  "schedule": {
    "0-0": {
      "subject": "高等数学",
      "teacher": "张教授",
      "location": "A301"
    },
    "0-1": {
      "subject": "高等数学",
      "teacher": "张教授",
      "location": "A301"
    },
    "1-0": {
      "subject": "大学英语",
      "teacher": "李老师",
      "location": "B205"
    },
    "2-0": {
      "subject": "机械制图",
      "teacher": "王教授",
      "location": "A302"
    },
    "2-2": {
      "subject": "电工电子",
      "teacher": "刘教授",
      "location": "实验楼101"
    },
    "3-1": {
      "subject": "机电设备维护",
      "teacher": "陈老师",
      "location": "实训中心"
    },
    "4-0": {
      "subject": "C语言程序设计",
      "teacher": "赵老师",
      "location": "机房201"
    },
    "5-2": {
      "subject": "体育",
      "teacher": "孙老师",
      "location": "体育馆"
    },
    "6-1": {
      "subject": "形势与政策",
      "teacher": "周老师",
      "location": "C103"
    }
  },
  "students": [
    {
      "id": "s1",
      "index": 1,
      "name": "韩子健",
      "studentId": "250671",
      "gender": "男",
      "dorm": "三号楼-615",
      "phone": "18729339963",
      "position": "",
      "notes": ""
    },
    {
      "id": "s2",
      "index": 2,
      "name": "张少泽",
      "studentId": "250731",
      "gender": "男",
      "dorm": "三号楼-615",
      "phone": "15229404199",
      "position": "",
      "notes": ""
    },
    {
      "id": "s3",
      "index": 3,
      "name": "徐宏庆",
      "studentId": "250644",
      "gender": "男",
      "dorm": "三号楼-617",
      "phone": "17791959985",
      "position": "",
      "notes": ""
    },
    {
      "id": "s4",
      "index": 4,
      "name": "车烁晗泽",
      "studentId": "250756",
      "gender": "男",
      "dorm": "三号楼-613",
      "phone": "17749070172",
      "position": "",
      "notes": ""
    },
    {
      "id": "s5",
      "index": 5,
      "name": "姬涵砾",
      "studentId": "250750",
      "gender": "男",
      "dorm": "三号楼-613",
      "phone": "18149331926",
      "position": "",
      "notes": ""
    },
    {
      "id": "s6",
      "index": 6,
      "name": "廖郭鑫",
      "studentId": "250795",
      "gender": "男",
      "dorm": "三号楼-614",
      "phone": "17319636214",
      "position": "",
      "notes": ""
    },
    {
      "id": "s7",
      "index": 7,
      "name": "王双龙",
      "studentId": "250655",
      "gender": "男",
      "dorm": "三号楼-613",
      "phone": "18792496200",
      "position": "",
      "notes": ""
    },
    {
      "id": "s8",
      "index": 8,
      "name": "陈磊",
      "studentId": "250643",
      "gender": "男",
      "dorm": "三号楼-617",
      "phone": "13022814558",
      "position": "",
      "notes": ""
    },
    {
      "id": "s9",
      "index": 9,
      "name": "史昊乾",
      "studentId": "250697",
      "gender": "男",
      "dorm": "三号楼-617",
      "phone": "15091076028",
      "position": "组织委员",
      "notes": ""
    },
    {
      "id": "s10",
      "index": 10,
      "name": "刘会杰",
      "studentId": "250816",
      "gender": "男",
      "dorm": "三号楼-617",
      "phone": "19815271715",
      "position": "副班长",
      "notes": ""
    },
    {
      "id": "s11",
      "index": 11,
      "name": "马世杰",
      "studentId": "250727",
      "gender": "男",
      "dorm": "三号楼-617",
      "phone": "18089116219",
      "position": "",
      "notes": ""
    },
    {
      "id": "s12",
      "index": 12,
      "name": "陈乾凯",
      "studentId": "250800",
      "gender": "男",
      "dorm": "三号楼-613",
      "phone": "19891535896",
      "position": "",
      "notes": ""
    },
    {
      "id": "s13",
      "index": 13,
      "name": "侯昕卓",
      "studentId": "250625",
      "gender": "男",
      "dorm": "三号楼-613",
      "phone": "15802926290",
      "position": "",
      "notes": ""
    },
    {
      "id": "s14",
      "index": 14,
      "name": "刘桓声",
      "studentId": "250748",
      "gender": "男",
      "dorm": "三号楼-615",
      "phone": "19992232033",
      "position": "",
      "notes": ""
    },
    {
      "id": "s15",
      "index": 15,
      "name": "加宇泽",
      "studentId": "250776",
      "gender": "男",
      "dorm": "三号楼-615",
      "phone": "15349110592",
      "position": "",
      "notes": ""
    },
    {
      "id": "s16",
      "index": 16,
      "name": "孙蓉琪",
      "studentId": "250725",
      "gender": "男",
      "dorm": "三号楼-614",
      "phone": "15091045038",
      "position": "",
      "notes": ""
    },
    {
      "id": "s17",
      "index": 17,
      "name": "田佳鹏",
      "studentId": "250818",
      "gender": "男",
      "dorm": "三号楼-615",
      "phone": "15389249132",
      "position": "",
      "notes": ""
    },
    {
      "id": "s18",
      "index": 18,
      "name": "张嘉程",
      "studentId": "250702",
      "gender": "男",
      "dorm": "三号楼-617",
      "phone": "19039090418",
      "position": "",
      "notes": ""
    },
    {
      "id": "s19",
      "index": 19,
      "name": "周嘉晨",
      "studentId": "250701",
      "gender": "男",
      "dorm": "三号楼-615",
      "phone": "19945386183",
      "position": "",
      "notes": ""
    },
    {
      "id": "s20",
      "index": 20,
      "name": "李阳",
      "studentId": "250653",
      "gender": "男",
      "dorm": "三号楼-615",
      "phone": "15002938957",
      "position": "",
      "notes": ""
    },
    {
      "id": "s21",
      "index": 21,
      "name": "张拓",
      "studentId": "250710",
      "gender": "男",
      "dorm": "三号楼-616",
      "phone": "17342084342",
      "position": "学习委员",
      "notes": ""
    },
    {
      "id": "s22",
      "index": 22,
      "name": "张轶铭",
      "studentId": "250668",
      "gender": "男",
      "dorm": "三号楼-616",
      "phone": "18049005896",
      "position": "班长",
      "notes": ""
    },
    {
      "id": "s23",
      "index": 23,
      "name": "高毅彬",
      "studentId": "250687",
      "gender": "男",
      "dorm": "三号楼-616",
      "phone": "17391207606",
      "position": "",
      "notes": ""
    },
    {
      "id": "s24",
      "index": 24,
      "name": "刘森威",
      "studentId": "250754",
      "gender": "男",
      "dorm": "三号楼-616",
      "phone": "13474149123",
      "position": "",
      "notes": ""
    },
    {
      "id": "s25",
      "index": 25,
      "name": "李伟翔",
      "studentId": "250740",
      "gender": "男",
      "dorm": "三号楼-616",
      "phone": "18391349941",
      "position": "",
      "notes": ""
    },
    {
      "id": "s26",
      "index": 26,
      "name": "薛恒立",
      "studentId": "250719",
      "gender": "男",
      "dorm": "三号楼-616",
      "phone": "13109632089",
      "position": "",
      "notes": ""
    },
    {
      "id": "s27",
      "index": 27,
      "name": "陈佳豪",
      "studentId": "250637",
      "gender": "男",
      "dorm": "三号楼-618",
      "phone": "15319798236",
      "position": "",
      "notes": ""
    },
    {
      "id": "s28",
      "index": 28,
      "name": "薛昊辰",
      "studentId": "250732",
      "gender": "男",
      "dorm": "三号楼-613",
      "phone": "15332233123",
      "position": "宣传委员",
      "notes": ""
    },
    {
      "id": "s29",
      "index": 29,
      "name": "曾怡凡",
      "studentId": "250799",
      "gender": "男",
      "dorm": "三号楼-614",
      "phone": "13991558335",
      "position": "",
      "notes": ""
    },
    {
      "id": "s30",
      "index": 30,
      "name": "刘洋",
      "studentId": "250627",
      "gender": "男",
      "dorm": "三号楼-618",
      "phone": "18992175361",
      "position": "",
      "notes": ""
    },
    {
      "id": "s31",
      "index": 31,
      "name": "张迄之",
      "studentId": "250617",
      "gender": "男",
      "dorm": "三号楼-614",
      "phone": "18909249597",
      "position": "",
      "notes": ""
    },
    {
      "id": "s32",
      "index": 32,
      "name": "甘兴旺",
      "studentId": "250782",
      "gender": "男",
      "dorm": "三号楼-617",
      "phone": "17764685350",
      "position": "",
      "notes": ""
    },
    {
      "id": "s33",
      "index": 33,
      "name": "周嘉宇",
      "studentId": "250724",
      "gender": "男",
      "dorm": "三号楼-613",
      "phone": "13008555291",
      "position": "",
      "notes": ""
    },
    {
      "id": "s34",
      "index": 34,
      "name": "柳博元",
      "studentId": "250647",
      "gender": "男",
      "dorm": "三号楼-613",
      "phone": "18149427635",
      "position": "",
      "notes": ""
    },
    {
      "id": "s35",
      "index": 35,
      "name": "王宇涵",
      "studentId": "250621",
      "gender": "女",
      "dorm": "二号楼-546",
      "phone": "13630259608",
      "position": "心理委员",
      "notes": ""
    },
    {
      "id": "s36",
      "index": 36,
      "name": "周心若",
      "studentId": "250802",
      "gender": "女",
      "dorm": "二号楼-546",
      "phone": "13347498136",
      "position": "生活委员",
      "notes": ""
    },
    {
      "id": "s37",
      "index": 37,
      "name": "哈芝萍",
      "studentId": "250797",
      "gender": "女",
      "dorm": "二号楼-546",
      "phone": "18091654075",
      "position": "",
      "notes": ""
    },
    {
      "id": "s38",
      "index": 38,
      "name": "邓鑫雨",
      "studentId": "250759",
      "gender": "女",
      "dorm": "二号楼-546",
      "phone": "15929756986",
      "position": "",
      "notes": ""
    },
    {
      "id": "s39",
      "index": 39,
      "name": "张锦辉",
      "studentId": "250693",
      "gender": "男",
      "dorm": "三号楼-617",
      "phone": "13772651513",
      "position": "",
      "notes": ""
    },
    {
      "id": "s40",
      "index": 40,
      "name": "谢锟晟",
      "studentId": "250715",
      "gender": "男",
      "dorm": "三号楼-614",
      "phone": "19916460128",
      "position": "",
      "notes": ""
    },
    {
      "id": "s41",
      "index": 41,
      "name": "田梦峥",
      "studentId": "250787",
      "gender": "男",
      "dorm": "三号楼-618",
      "phone": "13149169888",
      "position": "",
      "notes": ""
    },
    {
      "id": "s42",
      "index": 42,
      "name": "樊旭阳",
      "studentId": "250766",
      "gender": "男",
      "dorm": "三号楼-618",
      "phone": "15591700526",
      "position": "",
      "notes": ""
    },
    {
      "id": "s43",
      "index": 43,
      "name": "梁毅凡",
      "studentId": "250669",
      "gender": "男",
      "dorm": "三号楼-616",
      "phone": "15353631139",
      "position": "",
      "notes": ""
    },
    {
      "id": "s44",
      "index": 44,
      "name": "卓晗焯",
      "studentId": "250708",
      "gender": "女",
      "dorm": "三号楼-545",
      "phone": "13892092192",
      "position": "",
      "notes": ""
    },
    {
      "id": "s45",
      "index": 45,
      "name": "马歆钰",
      "studentId": "250675",
      "gender": "女",
      "dorm": "三号楼-545",
      "phone": "15829897069",
      "position": "团支书",
      "notes": ""
    },
    {
      "id": "s46",
      "index": 46,
      "name": "刘耀荣",
      "studentId": "250769",
      "gender": "男",
      "dorm": "三号楼-616",
      "phone": "17392099227",
      "position": "文体委员",
      "notes": ""
    },
    {
      "id": "s47",
      "index": 47,
      "name": "刘昊炜",
      "studentId": "250658",
      "gender": "男",
      "dorm": "三号楼-614",
      "phone": "18502911302",
      "position": "",
      "notes": ""
    },
    {
      "id": "s48",
      "index": 48,
      "name": "王江诚",
      "studentId": "250762",
      "gender": "男",
      "dorm": "三号楼-614",
      "phone": "15009261108",
      "position": "",
      "notes": ""
    },
    {
      "id": "s49",
      "index": 49,
      "name": "肖安炜",
      "studentId": "250803",
      "gender": "男",
      "dorm": "三号楼-614",
      "phone": "15667889805",
      "position": "",
      "notes": ""
    },
    {
      "id": "s50",
      "index": 50,
      "name": "张奕卓",
      "studentId": "250641",
      "gender": "男",
      "dorm": "三号楼-618",
      "phone": "18821692793",
      "position": "",
      "notes": ""
    },
    {
      "id": "s51",
      "index": 51,
      "name": "陈锦",
      "studentId": "250615",
      "gender": "男",
      "dorm": "三号楼-615",
      "phone": "17795601739",
      "position": "",
      "notes": ""
    }
  ],
  "duty": [
    {
      "id": "d1",
      "date": "",
      "weekday": "",
      "leader": "马歆钰",
      "members": "陈锦、张嘉程、周嘉晨、王江诚",
      "area": "教室、宿舍、公共区域（轮流值日）",
      "task": "第一组负责班级卫生值日，包含扫地、拖地、擦黑板、倒垃圾、整理讲台等",
      "status": "已完成"
    },
    {
      "id": "d2",
      "date": "",
      "weekday": "",
      "leader": "张拓",
      "members": "李伟翔、高毅彬、刘耀荣、张少泽",
      "area": "教室、宿舍、公共区域（轮流值日）",
      "task": "第二组负责班级卫生值日，包含扫地、拖地、擦黑板、倒垃圾、整理讲台等",
      "status": "已完成"
    },
    {
      "id": "d3",
      "date": "",
      "weekday": "",
      "leader": "田梦峥",
      "members": "陈佳豪、樊旭阳、刘洋、刘会杰",
      "area": "教室、宿舍、公共区域（轮流值日）",
      "task": "第三组负责班级卫生值日，包含扫地、拖地、擦黑板、倒垃圾、整理讲台等",
      "status": "已完成"
    },
    {
      "id": "d4",
      "date": "",
      "weekday": "",
      "leader": "廖郭鑫",
      "members": "孙蓉琪、韩子健、李阳、柳博元",
      "area": "教室、宿舍、公共区域（轮流值日）",
      "task": "第四组负责班级卫生值日，包含扫地、拖地、擦黑板、倒垃圾、整理讲台等",
      "status": "已完成"
    },
    {
      "id": "d5",
      "date": "",
      "weekday": "",
      "leader": "张轶铭",
      "members": "车烁晗泽、姬涵砾、王双龙、薛昊辰",
      "area": "教室、宿舍、公共区域（轮流值日）",
      "task": "第五组负责班级卫生值日，包含扫地、拖地、擦黑板、倒垃圾、整理讲台等",
      "status": "已完成"
    },
    {
      "id": "d6",
      "date": "",
      "weekday": "",
      "leader": "曾怡凡",
      "members": "卓涵焯、张奕卓、张迄之、田佳鹏",
      "area": "教室、宿舍、公共区域（轮流值日）",
      "task": "第六组负责班级卫生值日，包含扫地、拖地、擦黑板、倒垃圾、整理讲台等",
      "status": "已完成"
    },
    {
      "id": "d7",
      "date": "",
      "weekday": "",
      "leader": "薛恒立",
      "members": "刘森威、周嘉宇、梁毅凡、加宇泽、陈乾凯",
      "area": "教室、宿舍、公共区域（轮流值日）",
      "task": "第七组负责班级卫生值日，包含扫地、拖地、擦黑板、倒垃圾、整理讲台等",
      "status": "已完成"
    },
    {
      "id": "d8",
      "date": "",
      "weekday": "",
      "leader": "史昊乾",
      "members": "谢锟晟、肖安炜、刘昊炜、徐宏庆",
      "area": "教室、宿舍、公共区域（轮流值日）",
      "task": "第八组负责班级卫生值日，包含扫地、拖地、擦黑板、倒垃圾、整理讲台等",
      "status": "已完成"
    },
    {
      "id": "d9",
      "date": "",
      "weekday": "",
      "leader": "甘兴旺",
      "members": "陈磊、马世杰、张锦辉、刘桓声",
      "area": "教室、宿舍、公共区域（轮流值日）",
      "task": "第九组负责班级卫生值日，包含扫地、拖地、擦黑板、倒垃圾、整理讲台等",
      "status": "已完成"
    },
    {
      "id": "d10",
      "date": "",
      "weekday": "",
      "leader": "周心若",
      "members": "邓鑫雨、王宇涵、哈芝萍、侯昕卓",
      "area": "教室、宿舍、公共区域（轮流值日）",
      "task": "第十组负责班级卫生值日，包含扫地、拖地、擦黑板、倒垃圾、整理讲台等",
      "status": "已完成"
    }
  ],
  "weekly": [
    {
      "id": "w_real_17",
      "weekNum": "第17周",
      "dateRange": "2025-2026学年第二学期第17周",
      "study": "本周进入期末复习冲刺阶段，全班学习氛围显著升温。各科任课教师陆续完成新课讲授，转入系统复习串讲环节，课堂出勤率保持满勤状态。同学们课堂专注度较高，课后自发组成复习小组，利用晚自习及周末时间相互答疑、梳理知识框架。部分基础薄弱的同学主动向教师请教，学习积极性明显提升。班委配合教师整理并下发了各科复习提纲及往年试题，整体学风务实紧张，复习节奏有序推进。",
      "discipline": "本周班级整体舆情平稳向好，同学们的主要关注点集中于期末复习备考。班级群内讨论内容以学科重点难点交流、复习资料共享为主，未出现负面言论或不当言论传播。班主任在班会上强调了诚信备考、科学复习的重要性，引导同学们合理规划复习时间，避免盲目刷题和疲劳战术。个别同学因复习压力大出现短暂情绪波动，经谈心疏导后心态趋于平稳，班级舆论氛围积极健康。",
      "hygiene": "",
      "issues": "本周班主任联合班委持续开展矛盾排查工作。期末复习阶段学习节奏加快，宿舍内因作息时间差异偶有轻微摩擦，经班委协调后均及时化解。两名同学因自习座位使用问题产生口角，班主任第一时间介入调解，双方已握手言和。整体来看，班级人际关系和谐稳定，同学间互帮互助氛围浓厚，无重大矛盾纠纷隐患。",
      "measures": "本周班主任重点跟进期末复习阶段学生心理状态。通过课堂观察、宿舍走访及个别谈话，了解到多数同学能保持适度紧张感，复习动力充足。少数同学因个别学科基础薄弱产生焦虑情绪，班主任已协调任课教师给予针对性辅导，并安排学习骨干结对帮扶。同时提醒全班注意劳逸结合，保证充足睡眠，避免因过度复习导致身心疲惫，班级整体心理状态平稳可控。",
      "sourceFile": "assets/files/机电一体化2503第17周周分析.docx"
    }
  ],
  "monthly": [
    {
      "id": "m_real_1",
      "month": "3月",
      "item": "设施安全隐患排查",
      "content": "设施安全隐患\n（请对教室和宿舍内桌椅、灯具、门窗、镜框、床架、刀具、线路、电器等进行排查并记录情况）",
      "findings": "1. 教室：桌椅无松动/破损，灯具、开关正常工作，门窗闭合顺畅、锁具完好，线路无裸露/老化，消防器材（灭火器、应急灯）压力正常、无过期，多媒体设备运行正常；2. 宿舍：床架/护栏稳固无摇晃，衣柜/书架无倾倒风险，插座无破损、线路排列规范，无违规大功率电器（如热得快、电炉）；3. 内务安全：宿舍被子折叠整齐、物品摆放统一有序，地面干净清洁，无乱拉电线、存放易燃物品等情况",
      "measures": "",
      "responsible": "班主任、班委",
      "status": "已整改",
      "sourceFile": "assets/files/机电一体化2503班三月月排查.docx"
    },
    {
      "id": "m_real_2",
      "month": "3月",
      "item": "违禁物品排查",
      "content": "违禁物品排查",
      "findings": "经排查，宿舍及教室内未发现烟酒、管制刀具、易燃易爆物品、违规大功率电器、毒品及仿真毒品、非法出版物；手机已统一管理，无违规使用手机现象；无携带零食、化妆品等违禁物品",
      "measures": "",
      "responsible": "班主任、班委",
      "status": "已整改",
      "sourceFile": "assets/files/机电一体化2503班三月月排查.docx"
    },
    {
      "id": "m_real_3",
      "month": "3月",
      "item": "矛盾纠纷排查",
      "content": "是否存在矛盾纠纷",
      "findings": "班级同学关系融洽，服从管理、听从指挥，无因学习、生活、交往、内务评比等引发的口角争执、利益冲突、肢体冲突等矛盾纠纷，经私下沟通确认无隐性矛盾",
      "measures": "",
      "responsible": "班主任、班委",
      "status": "已整改",
      "sourceFile": "assets/files/机电一体化2503班三月月排查.docx"
    },
    {
      "id": "m_real_4",
      "month": "3月",
      "item": "重点学生情况说明",
      "content": "重点学生情况说明",
      "findings": "本班学生均能严格遵守校纪校规及半军事化管理规定，按时出操、整理内务，按时出勤、完成作业，作息规律；情绪状态稳定，无焦虑、抑郁等异常表现，主动与同学、老师沟通，服从管理、纪律意识较强，各项半军事化管理指标执行良好",
      "measures": "",
      "responsible": "班主任、班委",
      "status": "已整改",
      "sourceFile": "assets/files/机电一体化2503班三月月排查.docx"
    },
    {
      "id": "m_real_5",
      "month": "3月",
      "item": "网络舆情与心理健康",
      "content": "其他情况\n（网络舆情...）",
      "findings": "1. 网络舆情：无学生在社交平台发布负面言论、传播不良信息、网络造谣等情况，班级群内氛围积极向上；\n2. 心理健康：本月已完成与重点学生的谈心谈话工作，学生整体情绪稳定，无明显心理异常表现；\n3. 半军事化管理：班级队列整齐、口号响亮，内务检查合格率100%，早晚集合准时，无迟到早退现象，各项半军事化管理工作有序开展。",
      "measures": "",
      "responsible": "班主任、班委",
      "status": "已整改",
      "sourceFile": "assets/files/机电一体化2503班三月月排查.docx"
    }
  ],
  "talk": [
    {
      "id": "t_real_1",
      "date": "2026-03-09",
      "studentName": "张迄之",
      "topic": "校纪校规与出勤纪律",
      "content": "谈 心 谈 话 记 录\n谈话时间：  2026 年 03 月 09日    谈话地点： 机电309\n被谈话人： 机电一体化2503  班  张迄之  谈话人：\n谈话内容：学生无视校纪校规，上课迟到现象频发，我经过询问了解迟到原因，并对其进行思想教育。\n一、学生主要问题\n学生新学期返校后状态消极，存在明显厌学情绪，无心投入专业学习，迟迟无法适应校园学习生活节奏，内心抵触在校学习，萌生不想上学、放弃学业的想法。\n二、已采取的应对措施\n已第一时间与学生一对一谈心，耐心倾听其内心想法，舒缓负面情绪，消除学生戒备心理；结合铁路专业就业前景、学院培养方向做好正向引导，纠正其错误认知。\n三、后续拟应对措施\n后续将持续定期谈心疏导，实时把控学生思想动态；及时联动学生家长，搭建家校共育桥梁，共同做好思想引导；联合班委、舍友多关怀陪伴，帮助其融入集体；针对性做好学业引导，帮学生树立学习目标，逐步扭转消极心态，督促其回归正常学习生活。",
      "studentState": "需关注",
      "followUp": "持续定期谈心疏导；联动家长家校共育；联合班委、舍友多关怀陪伴；针对性学业引导。",
      "sourceFile": "assets/files/谈心谈话记录纸03月机电2503班（第一次张迄之）.docx"
    }
  ],
  "friendship": [
    {
      "id": "f_real_1",
      "date": "2026-5-14",
      "activityType": "联系学生",
      "participants": "窦咏咏、机电一体化2503 张迄之",
      "content": "学生未履行请假手续、擅自离校回家、造成全天缺课，经及时联系确认安全后严肃批评教育，要求补办手续并书面检讨。",
      "effect": "学生已返校并补办手续，家校沟通机制已启动，后续将持续跟踪观察。",
      "notes": "1. 对该生严肃批评教育，明确告知擅自离校的违规性质和可能面临的处分后果，端正其态度。\n2. 要求该生返校后第一时间到办公室当面谈话，补办请假手续，写出书面检讨，深刻反思。\n3. 与家长保持沟通，启动家校共管机制，共同加强日常管理，严防类似事件再次发生。",
      "sourceFile": "assets/files/机电工程学院“四进两联一交友”表格五月第1次（张迄之）.docx"
    }
  ],
  "meeting": [
    {
      "id": "mt_real_1",
      "date": "2026-5-21",
      "theme": "防火防电防意外，识险识灾识急救",
      "host": "班主任",
      "attendees": 51,
      "content": "机电一体化2503班召开“防火防电防意外，识险识灾识急救”主题班会\n安全无小事，责任重于泰山。为切实增强同学们的安全意识，提高自救互救能力，我班特召开此次安全主题班会，全面普及防火、用电安全及应急救护知识。\n本次班会围绕“防火防电防意外，识险识灾识急救”主题展开。班会中，我面向全体同学系统讲解了宿舍防火常识、安全用电规范、常见意外事故的预防与处理，以及基本的急救技能，帮助同学们全面了解安全知识的内容与意义。同时，我结合校园真实案例开展警示教育，强调了安全生活的重要性，引导同学们树立“安全第一预防为主”的意识，筑牢生命安全防线。班会过程中，我也收集了同学们对安全知识的疑问与反馈，为后续针对性安全教育做好了准备，推动安全教育落到实处。\n班会记录\n班会时间：2026年5月21日             班级：机电一体化2503班\n班会主题：防火防电防意外，识险识灾识急救\n班会内容：\n一、防火安全教育：火灾无情，防范在先\n班会一开始，我先向同学们展示了几组校园火灾案例的图片，现场气氛很严肃。我说，火灾不会提前告诉你它要来，我们能做的就是把防范工作做在前面。\n我着重讲解了宿舍防火的注意事项：禁止在宿舍使用大功率电器，禁止在床上充电，离开宿舍前必须关闭所有电源。我还现场演示了灭火器的正确使用方法，让同学们了解了“提、拔、握、压”的操作步骤。\n我特别强调了一点：我们机电一体化专业的同学，今后在实训车间操作设备时，更要牢记安全操作规程，因为工业场景中的安全事故往往比日常生活更为严重。\n二、用电安全与意外防范：细心谨慎，安全第一\n讲完防火内容后，我转到了用电安全和意外防范部分。我结合宿舍的实际情况，向同学们讲解了私拉乱接电线、超负荷用电的危害，以及触电后的紧急处理方法。\n我说，我们学机电的同学比其他专业的同学更接触电，但这不代表我们可以大意。相反，我们更应该懂电，才能更好地用电、更好地保护自己和他人。\n在意外防范部分，我介绍了宿舍内跌倒、运动损伤、食物中毒等常见意外的预防方法，让同学们对各类安全隐患有了更全面的认识。",
      "effect": "同学们进一步增强了安全意识和自我保护能力，班级安全氛围得到提升。",
      "status": "已开展",
      "sourceFile": "assets/files/防火防电防意外识险识灾识急救主题班会.docx"
    }
  ],
  "activity": [
    {
      "id": "a_real_1",
      "date": "2026-3-12",
      "name": " 华为红海订单班宣讲",
      "type": "其他",
      "participants": 51,
      "content": "机电一体化2503班召开“ 华为红海订单班宣讲”主题班会\n\n为深化产教融合，搭建优质就业发展桥梁，帮助同学们明晰职业发展方向、把握校企合作优质机遇，班级特召开“凝聚校企合力，筑梦职业未来”华为订单班宣讲主题班会，带领全体同学深入了解华为订单班项目优势、培养模式与发展前景，筑牢职业规划根基。\n班会围绕华为订单班宣讲主题展开。首先，班长结合行业趋势，介绍华为行业地位与技术优势，解读企业人才培养理念，点明订单班校企协同、定向培养、直通就业的核心优势。随后，详细讲解订单班定制教学、企业授课、实训实操、顶岗实习及就业保障等培养细则，明确报名选拔流程，解答同学们学业与就业相关疑问。在交流讨论环节，同学们踊跃提问，明晰专业短板，树立技能提升目标。最后，班会强调，华为订单班是专业发展优质机遇，希望同学们立足机电专业，把握培养资源，锤炼专业本领，规划学业目标，依托校企平台实现技能成才、高质量就业。\n\n\n\n\n班会记录\n班会时间：2026年3月12日              班级：机电一体化2503\n班会主题：华为红海订单班宣讲\n班会内容：\n\n1.订单班项目整体介绍  \n• 说明项目背景：华为红海订单班是学校与华为红海联合打造的校企定向培养项目，针对机电智能化方向培养技术技能人才，考核合格可直接进入对应岗位实习就业。 \n• 明确培养模式：采用「学校理论教学+企业项目实训」双轨培养，核心专业课由资深教师进课堂授课，实训环节直接进入企业生产场景实践。  \n\n2. 培养方向与就业前景说明 \n • 核心培养方向：工业机器人编程与操作、自动化生产线安装与调试运动控制技术与应用、机电设备故障诊断与维护、PLC与触摸屏变频器综合应用技术、电梯及控制技术应用，均为当前机电行业紧缺的核心技术。\n • 就业保障：完成培养且考核合格者，直接签订实习就业协议，薪资待遇、发展通道优于普通校招岗位。\n \n 3. 报名条件  \n• 报名基本要求：机电一体化专业，对机电智能化方向有浓厚兴趣。 \n \n4. 答疑与动员 \n• 开放提问环节，现场解答同学们关于培养内容、就业去向等疑问； \n• 动员：强调本次订单班是为同学们提供的定向就业绿色通道，鼓励大家结合自身职业规划，抓住本次校企合作的宝贵机会，积极报名参与选拔。",
      "result": "同学们对华为订单班项目有了深入了解，部分同学表示有意报名参加选拔。",
      "notes": "",
      "sourceFile": "assets/files/华为红海订单班文体活动记录.docx"
    }
  ],
  "leader": [
    {
      "id": "l1",
      "date": "2026-03-01",
      "studentName": "张轶铭",
      "position": "班长",
      "training": "班级管理方法、沟通技巧、活动策划",
      "method": "一对一指导",
      "progress": "已掌握基本管理方法，能独立组织班级活动，沟通能力有提升。",
      "notes": "表现优秀"
    },
    {
      "id": "l2",
      "date": "2026-03-05",
      "studentName": "马歆钰",
      "position": "团支书",
      "training": "团务知识、活动组织、宣传写作",
      "method": "集中培训",
      "progress": "团务工作熟悉度提升，能独立策划团日活动。",
      "notes": ""
    },
    {
      "id": "l3",
      "date": "2026-03-10",
      "studentName": "张拓",
      "position": "学习委员",
      "training": "学习管理、帮扶方法、数据分析",
      "method": "实践锻炼",
      "progress": "已组织成立学习互助小组，帮扶工作有序开展。",
      "notes": ""
    }
  ]
};

const SAMPLE_FILES = [
  {
    "id": "file_sample_1",
    "name": "机电一体化2503班第二学期值日表.xlsx",
    "module": "duty",
    "moduleTitle": "班级值日表",
    "type": "excel",
    "label": "Excel",
    "icon": "📊",
    "recordCount": 10,
    "createdAt": "2026-04-01T09:00:00.000Z",
    "assetUrl": "assets/files/机电一体化2503班第二学期值日表.xlsx"
  },
  {
    "id": "file_sample_2",
    "name": "总2025-2026学年学生信息登记表（机电一体化2503班）.xls",
    "module": "students",
    "moduleTitle": "学生情况",
    "type": "excel",
    "label": "Excel",
    "icon": "📊",
    "recordCount": 51,
    "createdAt": "2026-04-01T09:00:00.000Z",
    "assetUrl": "assets/files/总2025-2026学年学生信息登记表（XX班）.xls"
  },
  {
    "id": "file_sample_3",
    "name": "机电一体化2503第17周周分析.docx",
    "module": "weekly",
    "moduleTitle": "周分析",
    "type": "word",
    "label": "Word",
    "icon": "📝",
    "recordCount": 1,
    "createdAt": "2026-06-15T09:00:00.000Z",
    "assetUrl": "assets/files/机电一体化2503第17周周分析.docx"
  },
  {
    "id": "file_sample_4",
    "name": "机电一体化2503班三月月排查.docx",
    "module": "monthly",
    "moduleTitle": "月排查",
    "type": "word",
    "label": "Word",
    "icon": "📝",
    "recordCount": 5,
    "createdAt": "2026-03-31T09:00:00.000Z",
    "assetUrl": "assets/files/机电一体化2503班三月月排查.docx"
  },
  {
    "id": "file_sample_5",
    "name": "防火防电防意外识险识灾识急救主题班会.docx",
    "module": "meeting",
    "moduleTitle": "主题班会",
    "type": "word",
    "label": "Word",
    "icon": "📝",
    "recordCount": 1,
    "createdAt": "2026-05-21T09:00:00.000Z",
    "assetUrl": "assets/files/防火防电防意外识险识灾识急救主题班会.docx"
  },
  {
    "id": "file_sample_6",
    "name": "华为红海订单班文体活动记录.docx",
    "module": "activity",
    "moduleTitle": "文体活动",
    "type": "word",
    "label": "Word",
    "icon": "📝",
    "recordCount": 1,
    "createdAt": "2026-03-12T09:00:00.000Z",
    "assetUrl": "assets/files/华为红海订单班文体活动记录.docx"
  },
  {
    "id": "file_sample_7",
    "name": "谈心谈话记录纸03月机电2503班（第一次张迄之）.docx",
    "module": "talk",
    "moduleTitle": "谈心谈话",
    "type": "word",
    "label": "Word",
    "icon": "📝",
    "recordCount": 1,
    "createdAt": "2026-03-09T09:00:00.000Z",
    "assetUrl": "assets/files/谈心谈话记录纸03月机电2503班（第一次张迄之）.docx"
  },
  {
    "id": "file_sample_8",
    "name": "机电工程学院“四进两联一交友”表格五月第1次（张迄之）.docx",
    "module": "friendship",
    "moduleTitle": "四进两联一交友",
    "type": "word",
    "label": "Word",
    "icon": "📝",
    "recordCount": 1,
    "createdAt": "2026-05-14T09:00:00.000Z",
    "assetUrl": "assets/files/机电工程学院“四进两联一交友”表格五月第1次（张迄之）.docx"
  }
];
