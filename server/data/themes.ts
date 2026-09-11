/**
 * 主題板塊策展表（v0）
 * 這是「人工策展」資料：與證交所官方產業別不同，一檔股票可屬多個主題。
 * 維護規則：
 *  1. 只收「成員有把握」的代號——寧缺勿錯；漏掉的名單之後補，錯的成員會污染熱度分數。
 *  2. 新增主題時同步寫 note（策展依據），日後好審查。
 *  3. 引擎會自動過濾不存在於當日快照的代號；成員 < 3 檔的主題不上榜。
 */

export interface ThemeDef {
  id: string;
  name: string;
  symbols: string[];
  note?: string;
}

export const THEMES: ThemeDef[] = [
  {
    id: "ai-server",
    name: "AI 伺服器組裝",
    symbols: ["2317", "2382", "3231", "6669", "2356", "2376", "2377", "2357", "3380"],
    note: "雲端伺服器／機櫃組裝與 ODM",
  },
  {
    id: "liquid-cooling",
    name: "液冷散熱",
    symbols: ["3017", "3324", "6276", "2421", "6230", "3653", "3338"],
    note: "水冷板、快接頭、CDU 與散熱模組",
  },
  { id: "foundry", name: "晶圓代工", symbols: ["2330", "2303", "6770"], note: "代工製造" },
  { id: "ic-design", name: "IC 設計", symbols: ["2454", "3041", "2379", "6415", "4968"] },
  { id: "osat", name: "封裝測試", symbols: ["3711", "2449", "6239", "6147", "8081", "2329"] },
  { id: "advanced-packaging", name: "HBM／先進封裝", symbols: ["2330", "2449", "6510", "6640"], note: "CoWoS/HBM 相關製造與測試" },
  { id: "sem-material", name: "矽晶圓／半導體材料", symbols: ["6488", "8028", "4739", "4763"] },
  { id: "sem-equip", name: "半導體設備", symbols: ["6187", "3131", "3583"] },
  { id: "asic", name: "ASIC／AI 晶片設計", symbols: ["3661", "6533", "5269", "2330", "2454"], note: "客製化 AI 晶片設計服務" },
  { id: "pcb", name: "PCB／載板", symbols: ["4958", "3037", "8046", "2313", "3044", "2368", "2355"] },
  { id: "optics", name: "光通訊／光模組", symbols: ["6442", "4979", "3081", "3450", "3381"], note: "AI 機櫃光互連" },
  { id: "networking", name: "網通設備", symbols: ["2345", "3380", "5388", "6285"] },
  { id: "ems", name: "EMS 電子代工", symbols: ["2317", "2382", "2356", "3231", "2324", "2328"] },
  { id: "power", name: "電源／電力電子", symbols: ["2308", "2301"], note: "伺服器電源、充電樁電源" },
  { id: "connectors", name: "連接器／機構件", symbols: ["3533", "2059", "3321"], note: "金屬機構、連接器" },
  { id: "panel", name: "面板", symbols: ["3481", "2409", "6116"] },
  { id: "passive", name: "被動元件", symbols: ["2327", "2492"] },
  { id: "ev", name: "電動車供應鏈", symbols: ["2308", "2227", "3533", "1319", "1521"] },
  { id: "grid", name: "電網／重電", symbols: ["1601", "1609", "1618", "1604"], note: "變壓器、電纜、開關設備" },
  { id: "solar", name: "太陽能", symbols: ["3576", "6443", "6477"] },
  { id: "offshore-wind", name: "離岸風電", symbols: ["3708"] },
  { id: "automation", name: "機器人／自動化", symbols: ["2049", "3163", "4526"], note: "線性傳動、谐波減速、工具機" },
  { id: "shipping", name: "航運", symbols: ["2603", "2615", "2609", "2637", "2601"] },
  { id: "airline", name: "航空", symbols: ["2610", "2618"] },
  { id: "finance", name: "金控", symbols: ["2882", "2881", "2891", "2884", "2885", "2886", "2890", "2888", "2887"] },
  { id: "insurance", name: "純保險", symbols: ["2823", "2832", "2833", "2850"] },
  { id: "realestate", name: "營建", symbols: ["2548", "2545", "2504"] },
  { id: "telecom", name: "電信", symbols: ["2412", "4904", "3045"] },
  { id: "steel", name: "鋼鐵", symbols: ["2002", "2023", "2027"] },
  { id: "plastics", name: "塑化", symbols: ["1301", "1303", "1326", "6505", "1314"] },
  { id: "cement", name: "水泥", symbols: ["1101", "1102"] },
  { id: "textile", name: "紡織", symbols: ["1402", "1417"] },
  { id: "paper", name: "造紙", symbols: ["1907", "1902", "1904"] },
  { id: "retail", name: "量販百貨", symbols: ["2912", "2903", "2905"] },
  { id: "food", name: "美食餐飲", symbols: ["2723", "2727", "1256"] },
  { id: "tourism", name: "旅遊觀光", symbols: ["2707", "5704", "2739", "2748"] },
  { id: "apple", name: "蘋果供應鏈", symbols: ["2317", "2313", "3413", "3231", "2356"], note: "iPhone/iPad 組裝與零組件" },
  { id: "ai-pc", name: "AI PC／筆電", symbols: ["2357", "2377", "2382", "3231", "2356"] },
  { id: "gaming", name: "遊戲", symbols: ["6180", "5478"] },
];

/** 主題板塊的 zone id 前綴，用於與官方產業別區分 */
export const THEME_ID_PREFIX = "theme:";
