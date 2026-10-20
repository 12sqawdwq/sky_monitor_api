export const CONSTELLATION_ZH: Record<string, string> = {
  And: '仙女座', Ant: '唧筒座', Aps: '天燕座', Aqr: '宝瓶座', Aql: '天鹰座', Ara: '天坛座', Ari: '白羊座', Aur: '御夫座',
  Boo: '牧夫座', Cae: '雕具座', Cam: '鹿豹座', Cnc: '巨蟹座', CVn: '猎犬座', CMa: '大犬座', CMi: '小犬座', Cap: '摩羯座',
  Car: '船底座', Cas: '仙后座', Cen: '半人马座', Cep: '仙王座', Cet: '鲸鱼座', Cha: '蝘蜓座', Cir: '圆规座', Col: '天鸽座',
  Com: '后发座', CrA: '南冕座', CrB: '北冕座', Crv: '乌鸦座', Crt: '巨爵座', Cru: '南十字座', Cyg: '天鹅座', Del: '海豚座',
  Dor: '剑鱼座', Dra: '天龙座', Equ: '小马座', Eri: '波江座', For: '天炉座', Gem: '双子座', Gru: '天鹤座', Her: '武仙座',
  Hor: '时钟座', Hya: '长蛇座', Hyi: '水蛇座', Ind: '印第安座', Lac: '蝎虎座', Leo: '狮子座', LMi: '小狮座', Lep: '天兔座',
  Lib: '天秤座', Lup: '豺狼座', Lyn: '天猫座', Lyr: '天琴座', Men: '山案座', Mic: '显微镜座', Mon: '麒麟座', Mus: '苍蝇座',
  Nor: '矩尺座', Oct: '南极座', Oph: '蛇夫座', Ori: '猎户座', Pav: '孔雀座', Peg: '飞马座', Per: '英仙座', Phe: '凤凰座',
  Pic: '绘架座', Psc: '双鱼座', PsA: '南鱼座', Pup: '船尾座', Pyx: '罗盘座', Ret: '网罟座', Sge: '天箭座', Sgr: '人马座',
  Sco: '天蝎座', Scl: '玉夫座', Sct: '盾牌座', Ser: '巨蛇座', Sex: '六分仪座', Tau: '金牛座', Tel: '望远镜座', Tri: '三角座',
  TrA: '南三角座', Tuc: '杜鹃座', UMa: '大熊座', UMi: '小熊座', Vel: '船帆座', Vir: '室女座', Vol: '飞鱼座', Vul: '狐狸座'
};

export function constellationName(abbr?: string): string {
  if (!abbr) return '';
  return CONSTELLATION_ZH[abbr] ?? abbr;
}
