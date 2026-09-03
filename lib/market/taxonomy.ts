/*
 * The two translation tables that make a TAM ratio mean anything.
 *
 * Nothing on either side of the ratio is expressed in NAICS to begin with.
 * A client's own website says it sells into "Off-Road Equipment"; the prospect
 * record we would sell them says "Machinery"; the Census counts establishments
 * in 333120. Until all three are in the same units there is no denominator and
 * no fraction, only three unrelated words.
 *
 * So: MARKET_TERMS folds the free text clients use onto a canonical market,
 * MARKET_NAICS says what that market is in NAICS, and CRM_INDUSTRY_NAICS does
 * the same job for the label on our own prospect records.
 *
 * Two rules hold this together, both enforced by scripts/sync-market-taxonomy.mjs:
 *
 *   1. Every code must exist in naics_industries. A typo here silently shrinks
 *      a market rather than failing, which is the worst way for it to be wrong.
 *
 *   2. No code in a list may be a prefix of another in the same list. TAM is a
 *      sum over the list, so including both 3364 and 336411 counts the same
 *      establishments twice.
 *
 * Codes sit at whatever level is honest. Aerospace really is all of 3364, so it
 * is one four-digit code. Defense is a handful of six-digit ordnance codes and
 * nothing broader, because NAICS has no defense sector and pretending 3329
 * covers it would inflate the market tenfold.
 *
 * This file is the seed. The live copy is in market_terms / market_naics /
 * crm_industry_naics, editable in place by anyone with org.manage -- a
 * salesperson who knows a client's market better than this file does should be
 * able to fix it without a deploy. Re-running the sync restores these defaults
 * for the keys named here and leaves any hand-added rows alone.
 */

/** Canonical market -> the NAICS codes that make up its buying universe. */
export const MARKET_NAICS: Record<string, string[]> = {
  // --- Transportation equipment -------------------------------------------
  Aerospace: ["3364"],
  Automotive: ["3361", "3362", "3363"],
  "Heavy Truck": ["3362", "336120"],
  "Commercial Vehicles": ["3362", "336120"],
  Rail: ["3365"],
  Marine: ["3366", "4831", "4832"],
  "Recreational Vehicles": ["336214", "336991", "336999"],
  Motorsports: ["336991", "336999"],

  // --- Defense -------------------------------------------------------------
  // NAICS has no defense sector. These are the ordnance and military vehicle
  // codes; aerospace primes are counted under Aerospace, not twice here.
  Defense: ["332992", "332993", "332994", "336992"],

  // --- Machinery and equipment ---------------------------------------------
  "Industrial Machinery": ["3332", "3339"],
  "Construction Equipment": ["333120"],
  "Agricultural Equipment": ["333111", "333112"],
  "Mining Equipment": ["333131"],
  "Off-Road Equipment": ["333111", "333112", "333120", "333131"],
  "Material Handling": ["333921", "333922", "333923", "333924"],
  "Metalworking Machinery": ["3335"],
  "Power Systems": ["3336"],
  HVAC: ["3334", "238220"],
  Refrigeration: ["333415"],
  Robotics: ["333993", "333999"],
  "Industrial Automation": ["3345", "333993", "333999"],
  "Industrial Controls": ["334513", "335313", "335314"],
  Valves: ["332911", "332912", "332919"],
  Hydraulics: ["333995", "333996"],

  // --- Metals ---------------------------------------------------------------
  Steel: ["3311", "3312"],
  "Iron and Steel": ["3311", "3312"],
  Metals: ["3311", "3312", "3313", "3314", "3315"],
  Foundry: ["3315"],
  "Metal Fabrication": ["3323", "3327", "3329"],
  Stamping: ["3321"],
  "Metal Finishing": ["3328"],
  Welding: ["333992", "3323"],
  Composites: ["326199", "336413"],

  // --- Electronics ----------------------------------------------------------
  Electronics: ["3341", "3342", "3343", "3344", "3345", "3346"],
  Semiconductor: ["334413"],
  "Consumer Electronics": ["3343"],
  Optics: ["333314", "334511"],
  Lighting: ["3351"],
  Electrical: ["3353", "3359"],
  "Power Distribution": ["335311", "335313", "335314", "2211"],

  // --- Life sciences --------------------------------------------------------
  Medical: ["3391", "3254", "6211", "6221"],
  "Medical Devices": ["3391", "334510"],
  Dental: ["339114", "621210"],
  Pharmaceutical: ["3254"],
  Biotechnology: ["325414", "541714"],
  "Life Sciences": ["3254", "3391", "541714"],
  Healthcare: ["6211", "6216", "6221", "6231"],

  // --- Process industries ---------------------------------------------------
  Chemical: ["3251", "3252", "3253", "3255", "3256", "3259"],
  "Chemical Processing": ["3251", "3252", "3259"],
  Petrochemical: ["3241", "325110"],
  Refining: ["324110"],
  "Oil and Gas": ["2111", "2131", "3241"],
  Oilfield: ["213112", "333132"],
  Mining: ["2121", "2122", "2123", "2131"],
  Plastics: ["3261"],
  "Plastic Processing": ["3261"],
  Rubber: ["3262"],
  "Tire and Rubber": ["3262"],
  "Pulp and Paper": ["3221", "3222"],
  Packaging: ["3222", "326111", "326112", "326160", "332431", "332439"],
  Glass: ["3272"],
  Ceramics: ["3271"],

  // --- Food -----------------------------------------------------------------
  "Food and Beverage": ["3111", "3112", "3113", "3114", "3115", "3116", "3117", "3118", "3119", "3121"],
  "Food Processing": ["3114", "3115", "3116", "3117", "3118", "3119"],
  "Food Service": ["7223", "7225"],
  Agriculture: ["1151", "1152"],
  Aquaculture: ["114"],
  Forestry: ["113", "3211"],

  // --- Energy and utilities -------------------------------------------------
  Energy: ["2111", "2121", "2211", "2212", "3241"],
  "Power Generation": ["2211"],
  Nuclear: ["221113"],
  "Renewable Energy": ["221114", "221115", "221116", "221117", "221118"],
  Solar: ["221114", "334413"],
  Hydrogen: ["325120"],
  Biofuels: ["325193", "324110"],
  Utilities: ["2211", "2212", "2213"],
  "Water and Wastewater": ["221310", "221320", "237110"],
  "Waste Management": ["5621", "5622"],
  Recycling: ["562920", "423930"],

  // --- Built environment ----------------------------------------------------
  Construction: ["2361", "2362", "2371", "2372", "2373", "2379", "2381", "2382", "2383", "2389"],
  "Commercial Construction": ["2362", "2381", "2382", "2383", "2389"],
  Residential: ["2361", "2381", "2382", "2383"],
  Infrastructure: ["2371", "2372", "2373", "2379"],
  "Building Materials": ["3273", "3274", "3323", "321911", "327120"],
  Architectural: ["3323", "541310"],
  "Fire Protection": ["238220"],
  Woodworking: ["3219", "337"],
  Furniture: ["3371", "3372", "3379"],
  Appliance: ["3352"],

  // --- Logistics ------------------------------------------------------------
  Transportation: ["4811", "4831", "4832", "4841", "4842", "4881", "4884"],
  Logistics: ["4841", "4842", "4885", "4931", "541614"],
  Warehousing: ["4931"],
  Distribution: ["4231", "4232", "4233", "4234", "4235", "4236", "4237", "4238", "4239"],
  "Industrial Distribution": ["4238", "4237"],

  // --- Everything else ------------------------------------------------------
  "Data Centers": ["518210"],
  Telecommunications: ["5173", "5174", "5179", "3342"],
  Firearms: ["332994"],
  "Consumer Products": ["3399", "3352", "3371"],
  "Consumer Goods": ["3399", "3352", "3371"],
  Cosmetics: ["325620"],
  "Pet Care": ["311111", "424910"],
  Textiles: ["3131", "3132", "3133", "3141", "3149"],
  Printing: ["3231"],
  Education: ["6111", "6112", "6113"],
  Retail: ["44"],
  Hospitality: ["7211", "7223", "7225"],
  "Financial Services": ["5221", "5231", "5239"],
  Security: ["5616", "334290"],
  Fitness: ["713940", "339920"],
  Space: ["336414", "336415", "336419"],
  Shipbuilding: ["336611", "336612"],

  // --- Deliberately broad ---------------------------------------------------
  // These are what a client says when they mean "anyone who makes things".
  // Kept whole-sector on purpose: narrowing them would invent a precision the
  // client never expressed.
  Manufacturing: ["31"],
  Industrial: ["31", "2211", "2212"],
  Commercial: ["2362", "5311", "5312"],
};

/*
 * Free text -> canonical market.
 *
 * Keys are lowercased and trimmed exactly as they come out of
 * client_attributes. Every value must be a key of MARKET_NAICS.
 */
export const MARKET_TERMS: Record<string, string> = {
  // Aerospace and defense
  aerospace: "Aerospace",
  "aerospace and defense": "Aerospace",
  "aerospace & defense": "Aerospace",
  "aerospace and defence": "Aerospace",
  space: "Space",
  defense: "Defense",
  defence: "Defense",
  military: "Defense",
  "military & defense": "Defense",
  firearms: "Firearms",

  // Vehicles
  automotive: "Automotive",
  "electric vehicles": "Automotive",
  "e-mobility": "Automotive",
  "heavy truck": "Heavy Truck",
  "commercial truck": "Heavy Truck",
  "commercial vehicles": "Commercial Vehicles",
  motorsports: "Motorsports",
  rail: "Rail",
  railway: "Rail",
  railroad: "Rail",
  marine: "Marine",
  maritime: "Marine",
  shipbuilding: "Shipbuilding",
  "recreational vehicles": "Recreational Vehicles",
  rv: "Recreational Vehicles",

  // Machinery
  "heavy equipment": "Off-Road Equipment",
  "off-road equipment": "Off-Road Equipment",
  "construction equipment": "Construction Equipment",
  agricultural: "Agriculture",
  agriculture: "Agriculture",
  agribusiness: "Agriculture",
  "industrial equipment": "Industrial Machinery",
  "industrial machinery": "Industrial Machinery",
  "industrial products": "Industrial Machinery",
  "material handling": "Material Handling",
  "power systems": "Power Systems",
  power: "Power Systems",
  hvac: "HVAC",
  refrigeration: "Refrigeration",
  robotics: "Robotics",
  automation: "Industrial Automation",
  "industrial automation": "Industrial Automation",
  "industrial controls": "Industrial Controls",
  valves: "Valves",
  hydraulics: "Hydraulics",
  hydraulic: "Hydraulics",

  // Metals
  steel: "Steel",
  "steel manufacturing": "Steel",
  "iron and steel": "Iron and Steel",
  metals: "Metals",
  casting: "Foundry",
  "metal fabrication": "Metal Fabrication",
  fabrication: "Metal Fabrication",
  stamping: "Stamping",
  "metal finishing": "Metal Finishing",
  "finishing and coating": "Metal Finishing",
  welding: "Welding",
  machining: "Metal Fabrication",
  composites: "Composites",
  minerals: "Mining",

  // Electronics
  electronics: "Electronics",
  "electronics manufacturing": "Electronics",
  "industrial electronics": "Electronics",
  microelectronics: "Semiconductor",
  semiconductor: "Semiconductor",
  semiconductors: "Semiconductor",
  "consumer electronics": "Consumer Electronics",
  optics: "Optics",
  optical: "Optics",
  lighting: "Lighting",
  electrical: "Electrical",
  "power distribution": "Power Distribution",
  connectivity: "Telecommunications",
  telecommunications: "Telecommunications",
  telecom: "Telecommunications",
  communications: "Telecommunications",
  wireless: "Telecommunications",
  "data centers": "Data Centers",
  "mission critical facilities": "Data Centers",

  // Life sciences
  medical: "Medical",
  "medical devices": "Medical Devices",
  "medical device": "Medical Devices",
  "medical equipment": "Medical Devices",
  "medical technology": "Medical Devices",
  "medical offices": "Healthcare",
  healthcare: "Healthcare",
  "medical & pharma": "Life Sciences",
  "medical and pharmaceutical": "Life Sciences",
  "life sciences": "Life Sciences",
  pharmaceutical: "Pharmaceutical",
  pharmaceuticals: "Pharmaceutical",
  biotechnology: "Biotechnology",
  dental: "Dental",

  // Process
  chemical: "Chemical",
  "chemical manufacturing": "Chemical",
  "chemical processing": "Chemical Processing",
  petrochemical: "Petrochemical",
  refining: "Refining",
  "oil and gas": "Oil and Gas",
  "oil & gas": "Oil and Gas",
  oilfield: "Oilfield",
  "energy exploration": "Oil and Gas",
  mining: "Mining",
  plastics: "Plastics",
  "plastic processing": "Plastic Processing",
  "tire and rubber": "Tire and Rubber",
  "pulp and paper": "Pulp and Paper",
  "pulp & paper": "Pulp and Paper",
  packaging: "Packaging",
  "consumer packaging": "Packaging",
  "packaging and logistics": "Packaging",

  // Food
  "food and beverage": "Food and Beverage",
  "food & beverage": "Food and Beverage",
  food: "Food and Beverage",
  "food manufacturing": "Food Processing",
  "food processing": "Food Processing",
  "food production": "Food Processing",
  "food and pharma": "Food Processing",
  "food service": "Food Service",
  restaurants: "Food Service",
  aquaculture: "Aquaculture",
  forestry: "Forestry",

  // Energy
  energy: "Energy",
  "power generation": "Power Generation",
  nuclear: "Nuclear",
  "renewable energy": "Renewable Energy",
  "alternative energy": "Renewable Energy",
  solar: "Solar",
  "solar energy": "Solar",
  hydrogen: "Hydrogen",
  biofuels: "Biofuels",
  utilities: "Utilities",
  utility: "Utilities",
  "water and wastewater": "Water and Wastewater",
  "water & wastewater": "Water and Wastewater",
  "water treatment": "Water and Wastewater",
  "wastewater treatment": "Water and Wastewater",
  wastewater: "Water and Wastewater",
  "smart water": "Water and Wastewater",
  "municipal water": "Water and Wastewater",
  "waste management": "Waste Management",
  recycling: "Recycling",

  // Built environment
  construction: "Construction",
  "commercial construction": "Commercial Construction",
  "commercial buildings": "Commercial Construction",
  residential: "Residential",
  infrastructure: "Infrastructure",
  "critical infrastructure": "Infrastructure",
  "building materials": "Building Materials",
  architectural: "Architectural",
  architecture: "Architectural",
  "fire protection": "Fire Protection",
  woodworking: "Woodworking",
  furniture: "Furniture",
  appliance: "Appliance",
  appliances: "Appliance",
  "industrial facilities": "Industrial",

  // Logistics
  transportation: "Transportation",
  "transportation and logistics": "Transportation",
  logistics: "Logistics",
  "supply chain": "Logistics",
  warehousing: "Warehousing",
  warehouse: "Warehousing",
  "warehouse operations": "Warehousing",
  "warehouse and distribution": "Warehousing",
  distribution: "Distribution",
  "industrial distribution": "Industrial Distribution",

  // General
  manufacturing: "Manufacturing",
  "industrial manufacturing": "Manufacturing",
  "advanced manufacturing": "Manufacturing",
  "discrete manufacturing": "Manufacturing",
  "process manufacturing": "Chemical Processing",
  oem: "Manufacturing",
  industrial: "Industrial",
  "heavy industry": "Industrial",
  commercial: "Commercial",
  engineering: "Architectural",
  technology: "Electronics",

  // Consumer and services
  "consumer products": "Consumer Products",
  "consumer goods": "Consumer Goods",
  "consumer packaged goods": "Consumer Goods",
  consumer: "Consumer Goods",
  cosmetics: "Cosmetics",
  "pet care": "Pet Care",
  retail: "Retail",
  "e-commerce": "Retail",
  ecommerce: "Retail",
  hospitality: "Hospitality",
  education: "Education",
  "financial services": "Financial Services",
  banking: "Financial Services",
  security: "Security",
  fitness: "Fitness",
  entertainment: "Hospitality",
  "research and development": "Biotechnology",
};

/*
 * The label on our own prospect records -> NAICS.
 *
 * These come from the enrichment vendor's taxonomy, not ours: 172 values for
 * the entire economy, so most are far coarser than a market. "Machinery" is one
 * label covering all of NAICS 333. That looseness is real and the coverage math
 * measures it rather than hiding it -- see coverage_precision.
 *
 * Only the labels that can land in an industrial market are mapped. A prospect
 * labelled "Music" is not missing from this table by accident.
 */
export const CRM_INDUSTRY_NAICS: Record<string, string[]> = {
  // Manufacturing
  machinery: ["3331", "3332", "3333", "3334", "3335", "3336", "3339"],
  "industrial machinery & equipment": ["3332", "3339"],
  "electrical/electronic manufacturing": ["3341", "3342", "3343", "3344", "3345", "3346", "3351", "3352", "3353", "3359"],
  "mechanical or industrial engineering": ["3332", "3339", "541330"],
  "industrial automation": ["3345", "333993", "333999"],
  automotive: ["3361", "3362", "3363"],
  "aviation & aerospace": ["3364", "4811"],
  "airlines/aviation": ["4811", "4881"],
  "defense & space": ["3364", "332992", "332993", "332994", "336992"],
  "railroad manufacture": ["3365"],
  shipbuilding: ["336611", "336612"],
  maritime: ["3366", "4831", "4832"],
  "medical devices": ["3391", "334510"],
  pharmaceuticals: ["3254"],
  biotechnology: ["325414", "541714"],
  nanotechnology: ["541713"],
  semiconductors: ["334413"],
  "consumer electronics": ["3343"],
  "computer hardware": ["3341"],
  plastics: ["3261", "3262"],
  chemicals: ["3251", "3252", "3253", "3255", "3256", "3259"],
  "packaging & containers": ["3222", "326111", "326112", "326160", "332431", "332439"],
  "packaging and containers": ["3222", "326111", "326112", "326160", "332431", "332439"],
  "paper & forest products": ["3221", "3222", "3211", "113"],
  printing: ["3231"],
  furniture: ["3371", "3372", "3379"],
  textiles: ["3131", "3132", "3133", "3141", "3149"],
  "apparel & fashion": ["3151", "3152", "3159"],
  "food & beverages": ["3121", "3118", "3119"],
  "food production": ["3111", "3112", "3113", "3114", "3115", "3116", "3117"],
  dairy: ["3115"],
  "wine & spirits": ["312130", "312140"],
  "wine and spirits": ["312130", "312140"],
  tobacco: ["3122"],
  cosmetics: ["325620"],
  "building materials": ["3273", "3274", "321911", "327120"],
  "glass, ceramics & concrete": ["3271", "3272", "3273"],
  "mining & metals": ["2121", "2122", "2123", "3311", "3312", "3313", "3314", "3315"],
  "metal products manufacturing": ["3321", "3322", "3323", "3324", "3325", "3326", "3327", "3328", "3329"],
  "sporting goods": ["339920"],
  "luxury goods & jewelry": ["339910"],
  "business supplies & equipment": ["3339", "4234"],
  "business supplies and equipment": ["3339", "4234"],
  manufacturing: ["31"],

  // Resources and utilities
  "oil & energy": ["2111", "2131", "3241", "2211"],
  utilities: ["2211", "2212", "2213"],
  "renewables & environment": ["221114", "221115", "221116", "221117", "221118", "5622"],
  "environmental services": ["5621", "5622", "562910"],
  farming: ["1151"],
  agriculture: ["1151", "1152"],
  ranching: ["1152"],
  fishery: ["114"],

  // Built environment
  construction: ["2361", "2362", "2371", "2372", "2373", "2379", "2381", "2382", "2383", "2389"],
  "civil engineering": ["2371", "2372", "2373", "2379", "541330"],
  "architecture & planning": ["541310", "541320"],
  design: ["541410", "541420"],
  "facilities services": ["5617", "561210"],

  // Logistics and trade
  "transportation/trucking/railroad": ["4841", "4842"],
  "logistics & supply chain": ["4841", "4842", "4885", "4931"],
  "logistics and supply chain": ["4841", "4842", "4885", "4931"],
  warehousing: ["4931"],
  "package/freight delivery": ["4921", "4922"],
  wholesale: ["4231", "4232", "4233", "4234", "4235", "4236", "4237", "4238", "4239"],
  "import & export": ["4885"],
  "import and export": ["4885"],

  // Adjacent buyers that still sit in industrial markets
  "hospital & health care": ["6221", "6231"],
  "medical practice": ["6211", "6212", "6213"],
  veterinary: ["541940"],
  telecommunications: ["5173", "5174", "5179"],
  wireless: ["5173"],
  "computer networking": ["3342", "5182"],
  "consumer goods": ["3399", "3352", "3371"],
  restaurants: ["7225"],
  supermarkets: ["4451"],
  hospitality: ["7211"],
};
