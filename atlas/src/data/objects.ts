import { galacticToScene, length, raDecToScene, GALACTIC_CENTRE_LY, type Vec3 } from '../core/coords';

export type ObjectKind =
  | 'sun'
  | 'planet'
  | 'probe'
  | 'star'
  | 'nebula'
  | 'cluster'
  | 'globular'
  | 'core'
  | 'galaxy'
  | 'galaxy-cluster'
  | 'structure'
  | 'boundary';

export const KIND_LABEL: Record<ObjectKind, string> = {
  sun: '恒星 · 太阳',
  planet: '行星',
  probe: '人造探测器',
  star: '恒星',
  nebula: '星云',
  cluster: '疏散星团',
  globular: '球状星团',
  core: '银河系核心',
  galaxy: '星系',
  'galaxy-cluster': '星系团',
  structure: '宇宙大尺度结构',
  boundary: '宇宙边界'
};

export interface AtlasObject {
  id: string;
  zh: string;
  en: string;
  kind: ObjectKind;
  /** Scene position, light-years from the Sun. */
  pos: Vec3;
  /** Physical radius used to frame the object, light-years. */
  extent: number;
  mag?: number;
  absmag?: number;
  spect?: string;
  con?: string;
  des?: string;
  ra?: number;
  dec?: number;
  desc?: string;
  facts?: Array<[string, string]>;
  /** log10(camera radius) window in which the label may show. */
  label: [number, number];
  priority: number;
  /** Override for the distance shown in the archive (defaults to |pos|). */
  distance?: number;
}

export function objectDistance(object: AtlasObject): number {
  return object.distance ?? length(object.pos);
}

export function frameLogR(object: AtlasObject): number {
  return Math.log10(Math.max(object.extent * 3.2, 2e-5));
}

interface SkyEntry {
  id: string;
  zh: string;
  en: string;
  kind: ObjectKind;
  ra: number;
  dec: number;
  ly: number;
  extent: number;
  mag?: number;
  con?: string;
  desc: string;
  facts?: Array<[string, string]>;
}

const MILKY_WAY_OBJECTS: SkyEntry[] = [
  { id: 'Hyades', zh: '毕星团', en: 'Hyades', kind: 'cluster', ra: 66.75, dec: 15.87, ly: 153, extent: 10, mag: 0.5, con: 'Tau',
    desc: '离太阳最近的疏散星团，在金牛座呈 V 字形，毕宿五在视线方向上与它重叠，但距离只有它的三分之一。', facts: [['年龄', '约 6.25 亿年']] },
  { id: 'M45', zh: '昴星团', en: 'Pleiades · M45', kind: 'cluster', ra: 56.85, dec: 24.12, ly: 444, extent: 14, mag: 1.6, con: 'Tau',
    desc: '肉眼可见的“七姐妹”，由上千颗年轻炽热的恒星组成，它们正穿过一片与自身无关的星际尘埃，在照片上呈现反射星云。', facts: [['年龄', '约 1 亿年'], ['成员', '1000+ 颗恒星']] },
  { id: 'M44', zh: '蜂巢星团', en: 'Beehive · M44', kind: 'cluster', ra: 130.1, dec: 19.67, ly: 577, extent: 12, mag: 3.7, con: 'Cnc',
    desc: '巨蟹座中央的一团朦胧光斑，中国古称“积尸气”。双筒望远镜里可以分辨出几十颗成员星。' },
  { id: 'NGC 7293', zh: '螺旋星云', en: 'Helix Nebula', kind: 'nebula', ra: 337.41, dec: -20.84, ly: 655, extent: 1.5, mag: 7.6, con: 'Aqr',
    desc: '离我们最近的行星状星云之一：一颗类太阳恒星在生命末期抛出的外层气体，被裸露的白矮星内核照亮。这也是太阳约 50 亿年后的样子。' },
  { id: 'M7', zh: '托勒密星团', en: 'Ptolemy Cluster · M7', kind: 'cluster', ra: 268.45, dec: -34.79, ly: 980, extent: 12, mag: 3.3, con: 'Sco',
    desc: '天蝎座尾部的明亮疏散星团，公元 130 年左右已被托勒密记录，是最早被记载的深空天体之一。' },
  { id: 'M42', zh: '猎户座大星云', en: 'Orion Nebula · M42', kind: 'nebula', ra: 83.82, dec: -5.39, ly: 1344, extent: 12, mag: 4.0, con: 'Ori',
    desc: '离地球最近的大质量恒星形成区，肉眼可见于猎户座“剑”的位置。中心的四边形星团发出的紫外线点亮了整片气体云。', facts: [['直径', '约 24 光年']] },
  { id: 'M27', zh: '哑铃星云', en: 'Dumbbell Nebula · M27', kind: 'nebula', ra: 299.9, dec: 22.72, ly: 1360, extent: 1.3, mag: 7.5, con: 'Vul',
    desc: '第一个被发现的行星状星云（1764 年，梅西耶）。中心白矮星表面温度超过 8 万开。' },
  { id: 'M57', zh: '环状星云', en: 'Ring Nebula · M57', kind: 'nebula', ra: 283.396, dec: 33.029, ly: 2283, extent: 0.7, mag: 8.8, con: 'Lyr',
    desc: '天琴座中的一枚“烟圈”，是我们几乎沿极轴方向看到的一个行星状星云，膨胀速度约每秒 20~30 千米。' },
  { id: 'M8', zh: '礁湖星云', en: 'Lagoon Nebula · M8', kind: 'nebula', ra: 270.9, dec: -24.38, ly: 4100, extent: 55, mag: 6.0, con: 'Sgr',
    desc: '人马座方向的巨大电离氢区，横跨约 110 光年，夏夜在暗处可以肉眼看到一块微光。' },
  { id: 'M20', zh: '三叶星云', en: 'Trifid Nebula · M20', kind: 'nebula', ra: 270.6, dec: -23.03, ly: 5200, extent: 20, mag: 6.3, con: 'Sgr',
    desc: '发射星云、反射星云和暗星云同框的少见天体，被三条暗尘带分成“三叶”。' },
  { id: 'M11', zh: '野鸭星团', en: 'Wild Duck Cluster · M11', kind: 'cluster', ra: 282.77, dec: -6.27, ly: 6200, extent: 12, mag: 5.8, con: 'Sct',
    desc: '最致密的疏散星团之一，约 2900 颗恒星挤在 20 光年的范围内，形状像一群飞行的野鸭。' },
  { id: 'M1', zh: '蟹状星云', en: 'Crab Nebula · M1', kind: 'nebula', ra: 83.633, dec: 22.014, ly: 6500, extent: 5.5, mag: 8.4, con: 'Tau',
    desc: '公元 1054 年超新星的遗迹，《宋会要》记载其“昼见如太白”。中心是一颗每秒自转 30 次的脉冲星。', facts: [['爆发', '1054 年（宋代记载）'], ['核心', '蟹状星云脉冲星']] },
  { id: 'M16', zh: '鹰状星云', en: 'Eagle Nebula · M16', kind: 'nebula', ra: 274.7, dec: -13.81, ly: 7000, extent: 35, mag: 6.0, con: 'Ser',
    desc: '哈勃“创生之柱”所在地：几光年高的气体尘埃柱正被附近年轻恒星的辐射侵蚀，柱顶仍在孕育新的恒星。' },
  { id: 'NGC 869/884', zh: '英仙座双星团', en: 'Double Cluster', kind: 'cluster', ra: 34.75, dec: 57.13, ly: 7500, extent: 35, mag: 3.7, con: 'Per',
    desc: '两团并肩的年轻疏散星团，肉眼可见于英仙座与仙后座之间，是英仙臂上的地标。' },
  { id: 'NGC 3372', zh: '船底座星云', en: 'Carina Nebula', kind: 'nebula', ra: 161.27, dec: -59.87, ly: 8500, extent: 115, mag: 1.0, con: 'Car',
    desc: '南天最壮观的星云之一，比猎户座大星云大 4 倍。其中的海山二是一个即将走向超新星的高光度双星系统。' },
  { id: 'M22', zh: 'M22 球状星团', en: 'Sagittarius Cluster · M22', kind: 'globular', ra: 279.1, dec: -23.9, ly: 10600, extent: 50, mag: 5.1, con: 'Sgr',
    desc: '离地球最近的球状星团之一，几十万颗古老恒星的聚集体，年龄约 120 亿年。' },
  { id: 'NGC 5139', zh: '半人马座 ω', en: 'Omega Centauri', kind: 'globular', ra: 201.7, dec: -47.48, ly: 17090, extent: 75, mag: 3.9, con: 'Cen',
    desc: '银河系最大最亮的球状星团，约一千万颗恒星。它可能是一个被银河系吞并的矮星系残留下来的核心。', facts: [['恒星数', '约 1000 万']] },
  { id: 'M13', zh: '武仙座大星团', en: 'Hercules Cluster · M13', kind: 'globular', ra: 250.42, dec: 36.46, ly: 22200, extent: 72, mag: 5.8, con: 'Her',
    desc: '北天最著名的球状星团。1974 年阿雷西博射电望远镜向它发出了人类第一条主动星际信息。', facts: [['阿雷西博信息', '1974 年发送']] }
];

interface GalacticEntry {
  id: string;
  zh: string;
  en: string;
  kind: ObjectKind;
  l: number;
  b: number;
  ly: number;
  diameter: number;
  desc: string;
  facts?: Array<[string, string]>;
  priority?: number;
}

export const LOCAL_GROUP: GalacticEntry[] = [
  { id: 'Sgr dSph', zh: '人马座矮椭球星系', en: 'Sagittarius Dwarf', kind: 'galaxy', l: 5.6, b: -14.2, ly: 65000, diameter: 10000,
    desc: '正在被银河系潮汐撕裂的卫星星系，它的恒星流已经绕银河系拉出一圈。它在银盘另一侧，被银心挡住，直到 1994 年才被发现。' },
  { id: 'LMC', zh: '大麦哲伦云', en: 'Large Magellanic Cloud', kind: 'galaxy', l: 280.47, b: -32.89, ly: 163000, diameter: 32000, priority: 3,
    desc: '银河系最大的卫星星系，南半球肉眼可见。1987 年这里爆发的超新星 SN 1987A 是近代离我们最近的一次。', facts: [['质量', '约银河系的 1/10']] },
  { id: 'SMC', zh: '小麦哲伦云', en: 'Small Magellanic Cloud', kind: 'galaxy', l: 302.8, b: -44.3, ly: 200000, diameter: 18900, priority: 2,
    desc: '与大麦哲伦云结伴绕行的不规则矮星系，两者之间有一条气体“麦哲伦桥”。' },
  { id: 'UMi dSph', zh: '小熊座矮星系', en: 'Ursa Minor Dwarf', kind: 'galaxy', l: 104.97, b: 44.8, ly: 225000, diameter: 1000, desc: '暗弱的矮椭球卫星星系，恒星几乎全部古老，暗物质占绝对主导。' },
  { id: 'Dra dSph', zh: '天龙座矮星系', en: 'Draco Dwarf', kind: 'galaxy', l: 86.37, b: 34.72, ly: 260000, diameter: 2700, desc: '已知暗物质含量最高的天体之一，质光比可达数百。' },
  { id: 'Scl dSph', zh: '玉夫座矮星系', en: 'Sculptor Dwarf', kind: 'galaxy', l: 287.5, b: -83.2, ly: 290000, diameter: 3000, desc: '1937 年发现的第一个矮椭球星系。' },
  { id: 'Sex dSph', zh: '六分仪座矮星系', en: 'Sextans Dwarf', kind: 'galaxy', l: 243.5, b: 42.3, ly: 290000, diameter: 8000, desc: '面亮度极低的卫星星系，直到 1990 年才被发现。' },
  { id: 'Car dSph', zh: '船底座矮星系', en: 'Carina Dwarf', kind: 'galaxy', l: 260.1, b: -22.2, ly: 330000, diameter: 1600, desc: '经历过数次间歇性恒星形成的矮星系。' },
  { id: 'For dSph', zh: '天炉座矮星系', en: 'Fornax Dwarf', kind: 'galaxy', l: 237.1, b: -65.7, ly: 460000, diameter: 6000, desc: '拥有 6 个自己的球状星团的矮椭球星系。' },
  { id: 'Leo II', zh: '狮子座 II', en: 'Leo II', kind: 'galaxy', l: 220.2, b: 67.2, ly: 690000, diameter: 1100, desc: '远离银河系的矮椭球卫星星系。' },
  { id: 'Leo I', zh: '狮子座 I', en: 'Leo I', kind: 'galaxy', l: 226.0, b: 49.1, ly: 820000, diameter: 2000, desc: '紧贴轩辕十四的方向，常被这颗亮星的光芒淹没。' },
  { id: 'Phx', zh: '凤凰座矮星系', en: 'Phoenix Dwarf', kind: 'galaxy', l: 272.2, b: -68.9, ly: 1440000, diameter: 2000, desc: '介于矮椭球与矮不规则之间的过渡型星系。' },
  { id: 'NGC 6822', zh: '巴纳德星系', en: "Barnard's Galaxy", kind: 'galaxy', l: 25.3, b: -18.4, ly: 1630000, diameter: 7000, desc: '本星系群中的棒旋不规则矮星系，结构类似小麦哲伦云。' },
  { id: 'NGC 185', zh: 'NGC 185', en: 'NGC 185', kind: 'galaxy', l: 120.8, b: -14.5, ly: 2020000, diameter: 8000, desc: '仙女座星系的矮椭球卫星。' },
  { id: 'And II', zh: '仙女座 II', en: 'Andromeda II', kind: 'galaxy', l: 128.9, b: -29.2, ly: 2130000, diameter: 3000, desc: '仙女座星系的暗弱卫星。' },
  { id: 'IC 10', zh: 'IC 10', en: 'IC 10', kind: 'galaxy', l: 119.0, b: -3.3, ly: 2200000, diameter: 5000, desc: '本星系群中唯一已知的星暴星系，恒星形成异常活跃。' },
  { id: 'IC 1613', zh: 'IC 1613', en: 'IC 1613', kind: 'galaxy', l: 129.8, b: -60.6, ly: 2380000, diameter: 12000, desc: '尘埃极少的矮不规则星系，是标定造父变星距离的“干净”样本。' },
  { id: 'M32', zh: 'M32', en: 'M32', kind: 'galaxy', l: 121.15, b: -21.98, ly: 2490000, diameter: 6500, desc: '仙女座星系旁的致密椭圆星系，可能是一个被剥去外层的盘星系的核心。' },
  { id: 'M31', zh: '仙女座星系', en: 'Andromeda Galaxy · M31', kind: 'galaxy', l: 121.17, b: -21.57, ly: 2537000, diameter: 152000, priority: 5,
    desc: '肉眼可见的最远天体。本星系群中最大的星系，正以每秒约 110 千米的速度接近银河系，约 45 亿年后两者将开始并合。', facts: [['恒星数', '约 1 万亿'], ['并合', '约 45 亿年后']] },
  { id: 'NGC 147', zh: 'NGC 147', en: 'NGC 147', kind: 'galaxy', l: 119.8, b: -14.3, ly: 2530000, diameter: 10000, desc: '仙女座星系的矮椭球卫星，与 NGC 185 组成一对。' },
  { id: 'Leo A', zh: '狮子座 A', en: 'Leo A', kind: 'galaxy', l: 196.9, b: 52.4, ly: 2600000, diameter: 5000, desc: '孤立的矮不规则星系，大部分恒星形成发生在近 80 亿年内。' },
  { id: 'M110', zh: 'M110', en: 'M110', kind: 'galaxy', l: 120.72, b: -21.14, ly: 2690000, diameter: 17000, desc: '仙女座星系的另一颗较大卫星，属于矮椭圆星系。' },
  { id: 'M33', zh: '三角座星系', en: 'Triangulum Galaxy · M33', kind: 'galaxy', l: 133.61, b: -31.33, ly: 2730000, diameter: 61000, priority: 4,
    desc: '本星系群第三大成员，一个松散的旋涡星系。在极暗的夜空下它可能是肉眼可见的最远天体。' },
  { id: 'WLM', zh: 'WLM 星系', en: 'Wolf–Lundmark–Melotte', kind: 'galaxy', l: 75.9, b: -73.6, ly: 3040000, diameter: 8000, desc: '位于本星系群边缘的孤立矮星系，几乎没有与其他星系相互作用过。' }
];

export const NEARBY_UNIVERSE: GalacticEntry[] = [
  { id: 'NGC 253', zh: '玉夫座星系', en: 'Sculptor Galaxy', kind: 'galaxy', l: 97.4, b: -88.0, ly: 11400000, diameter: 90000, desc: '玉夫座星系群中最亮的成员，一个尘埃丰富的星暴星系。' },
  { id: 'M81', zh: '波德星系', en: "Bode's Galaxy · M81", kind: 'galaxy', l: 142.1, b: 40.9, ly: 11800000, diameter: 90000, priority: 3, desc: 'M81 星系群的主星系，与邻居 M82（雪茄星系）的引力相互作用触发了 M82 的星暴。' },
  { id: 'Cen A', zh: '半人马座 A', en: 'Centaurus A', kind: 'galaxy', l: 309.5, b: 19.4, ly: 12000000, diameter: 60000, priority: 3, desc: '最近的射电星系之一，中心超大质量黑洞喷出的喷流延伸数十万光年，横贯其上的尘埃带来自一次星系并合。' },
  { id: 'M101', zh: '风车星系', en: 'Pinwheel Galaxy · M101', kind: 'galaxy', l: 102.0, b: 59.8, ly: 20900000, diameter: 170000, desc: '正面朝向我们的大型旋涡星系，直径接近银河系的两倍。' },
  { id: 'M51', zh: '涡状星系', en: 'Whirlpool Galaxy · M51', kind: 'galaxy', l: 104.85, b: 68.56, ly: 23000000, diameter: 76000, priority: 2, desc: '第一个被认出旋涡结构的星系（1845 年，罗斯伯爵），伴星系 NGC 5195 正在拉扯它的一条旋臂。' },
  { id: 'M104', zh: '草帽星系', en: 'Sombrero Galaxy · M104', kind: 'galaxy', l: 298.46, b: 51.15, ly: 31000000, diameter: 50000, desc: '近乎侧向的星系，明亮的核球和一道清晰的尘埃带使它像一顶墨西哥草帽。' },
  { id: 'M87', zh: 'M87', en: 'Messier 87', kind: 'galaxy', l: 283.78, b: 74.49, ly: 53500000, diameter: 120000, priority: 3, desc: '室女座星系团中心的巨椭圆星系。2019 年事件视界望远镜拍下的第一张黑洞照片就是它中心 65 亿倍太阳质量的黑洞。', facts: [['中心黑洞', '约 65 亿倍太阳质量']] },
  { id: 'Virgo Cluster', zh: '室女座星系团', en: 'Virgo Cluster', kind: 'galaxy-cluster', l: 283.8, b: 74.5, ly: 54000000, diameter: 15000000, priority: 4, desc: '离我们最近的大型星系团，包含 1300 多个星系。本星系群正被它的引力拉向它。', facts: [['成员', '约 1300–2000 个星系']] },
  { id: 'Fornax Cluster', zh: '天炉座星系团', en: 'Fornax Cluster', kind: 'galaxy-cluster', l: 236.7, b: -53.6, ly: 62000000, diameter: 6000000, priority: 2, desc: '第二近的星系团，比室女座星系团小但更致密。' },
  { id: 'Hydra Cluster', zh: '长蛇座星系团', en: 'Hydra Cluster', kind: 'galaxy-cluster', l: 269.6, b: 26.5, ly: 158000000, diameter: 10000000, priority: 2, desc: '拉尼亚凯亚超星系团内部的大型星系团之一。' },
  { id: 'Centaurus Cluster', zh: '半人马座星系团', en: 'Centaurus Cluster', kind: 'galaxy-cluster', l: 302.4, b: 21.6, ly: 170000000, diameter: 10000000, priority: 2, desc: '富含热气体的星系团，位于长蛇-半人马超星系团中心区域。' },
  { id: 'Great Attractor', zh: '巨引源', en: 'Great Attractor · Norma Cluster', kind: 'galaxy-cluster', l: 325.3, b: -7.3, ly: 220000000, diameter: 20000000, priority: 4,
    desc: '一个被银盘尘埃遮挡的巨大引力中心，周围数万个星系（包括银河系）都在朝它运动。矩尺座星系团位于其核心。' },
  { id: 'Perseus Cluster', zh: '英仙座星系团', en: 'Perseus Cluster', kind: 'galaxy-cluster', l: 150.6, b: -13.3, ly: 240000000, diameter: 15000000, priority: 2, desc: 'X 射线天空中最亮的星系团，中心黑洞发出的声波对应比中央 C 低 57 个八度的“音符”。' },
  { id: 'Coma Cluster', zh: '后发座星系团', en: 'Coma Cluster', kind: 'galaxy-cluster', l: 58.1, b: 88.0, ly: 321000000, diameter: 20000000, priority: 3, desc: '1933 年兹威基研究它的星系运动，第一次推断出“暗物质”的存在。', facts: [['历史', '暗物质概念的发源地']] },
  { id: 'Shapley Supercluster', zh: '沙普利超星系团', en: 'Shapley Supercluster', kind: 'structure', l: 312, b: 31, ly: 650000000, diameter: 140000000, priority: 3, desc: '近邻宇宙中质量最大的星系集中区，它和巨引源一起主导着我们所在区域的星系运动。' }
];

interface EquatorialStructure {
  id: string;
  zh: string;
  en: string;
  kind: ObjectKind;
  ra: number;
  dec: number;
  ly: number;
  diameter: number;
  desc: string;
  priority: number;
}

const STRUCTURES: EquatorialStructure[] = [
  { id: 'Bootes Void', zh: '牧夫座空洞', en: 'Boötes Void', kind: 'structure', ra: 222.5, dec: 46, ly: 700000000, diameter: 330000000, priority: 2,
    desc: '直径约 3.3 亿光年的“宇宙大空洞”，内部只发现了约 60 个星系。如果银河系在它中心，直到 1960 年代人类都不会知道还有别的星系。' },
  { id: 'Sloan Great Wall', zh: '斯隆长城', en: 'Sloan Great Wall', kind: 'structure', ra: 195, dec: 1, ly: 1000000000, diameter: 1380000000, priority: 2,
    desc: '由斯隆数字巡天发现的星系“长城”，长约 14 亿光年，是已知最大的结构之一。' }
];

function fromSky(entry: SkyEntry): AtlasObject {
  return {
    id: entry.id,
    zh: entry.zh,
    en: entry.en,
    kind: entry.kind,
    pos: raDecToScene(entry.ra, entry.dec, entry.ly),
    extent: entry.extent,
    mag: entry.mag,
    con: entry.con,
    ra: entry.ra,
    dec: entry.dec,
    desc: entry.desc,
    facts: entry.facts,
    label: [Math.log10(entry.ly) - 2.4, Math.log10(entry.ly) + 1.6],
    priority: entry.kind === 'nebula' ? 2.2 : 2
  };
}

function fromGalactic(entry: GalacticEntry, label: [number, number]): AtlasObject {
  return {
    id: entry.id,
    zh: entry.zh,
    en: entry.en,
    kind: entry.kind,
    pos: galacticToScene(entry.l, entry.b, entry.ly),
    extent: entry.diameter / 2,
    desc: entry.desc,
    facts: [['直径', `${entry.diameter.toLocaleString('en-US')} 光年`], ...(entry.facts ?? [])],
    label,
    priority: entry.priority ?? 1
  };
}

export function buildCatalogObjects(): AtlasObject[] {
  const objects: AtlasObject[] = [];
  objects.push(...MILKY_WAY_OBJECTS.map(fromSky));

  objects.push({
    id: 'Sgr A*',
    zh: '银心 · 人马座 A*',
    en: 'Galactic Centre · Sgr A*',
    kind: 'core',
    pos: [GALACTIC_CENTRE_LY, 0, 0],
    extent: 900,
    ra: 266.4168,
    dec: -29.0078,
    con: 'Sgr',
    desc: '银河系的引力中心，藏着一个约 430 万倍太阳质量的超大质量黑洞。2022 年事件视界望远镜发布了它的照片。太阳绕它转一圈约需 2.3 亿年。',
    facts: [['黑洞质量', '约 430 万倍太阳质量'], ['太阳公转周期', '约 2.3 亿年']],
    label: [3.3, 6.2],
    priority: 4.5
  });

  objects.push({
    id: 'Milky Way',
    zh: '银河系',
    en: 'Milky Way',
    kind: 'galaxy',
    pos: [GALACTIC_CENTRE_LY, 0, 0],
    extent: 52000,
    desc: '我们的家园星系：一个直径约 10 万光年的棒旋星系，有 1000–4000 亿颗恒星。太阳位于猎户臂（本地臂）上，距中心约 2.67 万光年。',
    facts: [['恒星数', '1000–4000 亿'], ['直径', '约 10 万光年'], ['太阳位置', '距银心 2.67 万光年']],
    label: [5.6, 8.3],
    priority: 5,
    distance: GALACTIC_CENTRE_LY
  });

  for (const entry of LOCAL_GROUP) {
    const big = entry.diameter > 15000;
    // Satellites inside ~0.5 Mly label from Milky Way scale; the M31 system from Local Group scale.
    const near = entry.ly < 5e5;
    objects.push(fromGalactic(entry, near ? [4.9, big ? 7.6 : 6.8] : [big ? 5.9 : 6.3, big ? 8.4 : 7.4]));
  }

  objects.push({
    id: 'Local Group',
    zh: '本星系群',
    en: 'Local Group',
    kind: 'galaxy-cluster',
    pos: galacticToScene(121.17, -21.57, 1100000),
    extent: 4000000,
    desc: '银河系所在的星系群，约 80 个成员，由银河系和仙女座星系两大引力中心主导，直径约 1000 万光年。',
    facts: [['成员', '80+ 个星系'], ['直径', '约 1000 万光年']],
    label: [7.1, 9.4],
    priority: 4
  });

  for (const entry of NEARBY_UNIVERSE) {
    const isCluster = entry.kind !== 'galaxy';
    const logD = Math.log10(entry.ly);
    objects.push(fromGalactic(entry, isCluster ? [logD - 1.6, logD + 1.9] : [logD - 2.2, logD + 0.6]));
  }

  objects.push({
    id: 'Laniakea',
    zh: '拉尼亚凯亚超星系团',
    en: 'Laniakea Supercluster',
    kind: 'structure',
    pos: galacticToScene(325.3, -7.3, 160000000),
    extent: 260000000,
    desc: '“无尽的天堂”（夏威夷语）。2014 年按星系的运动流划定的超星系团，包含约 10 万个星系，银河系位于它的边缘，室女座超星系团只是它的一个分支。',
    facts: [['直径', '约 5.2 亿光年'], ['星系数', '约 10 万个']],
    label: [8.4, 10.2],
    priority: 4.6
  });

  for (const entry of STRUCTURES) {
    objects.push({
      id: entry.id,
      zh: entry.zh,
      en: entry.en,
      kind: entry.kind,
      pos: raDecToScene(entry.ra, entry.dec, entry.ly),
      extent: entry.diameter / 2,
      desc: entry.desc,
      facts: [['尺度', `约 ${(entry.diameter / 1e8).toFixed(1)} 亿光年`]],
      label: [8.7, 10.6],
      priority: entry.priority
    });
  }

  objects.push({
    id: 'Observable Universe',
    zh: '可观测宇宙',
    en: 'Observable Universe',
    kind: 'boundary',
    pos: [0, 0, 0],
    extent: 46500000000,
    desc: '光自宇宙诞生以来能抵达我们的最远范围。边界上是 138 亿年前发出的宇宙微波背景辐射，由于宇宙膨胀，那片区域如今离我们约 465 亿光年。',
    facts: [['半径', '约 465 亿光年'], ['宇宙年龄', '约 138 亿年'], ['星系数', '约 2 万亿（估计）']],
    label: [10.4, 12],
    priority: 5,
    distance: 46500000000
  });

  return objects;
}
