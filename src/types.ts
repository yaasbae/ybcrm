export interface UnitEconomics {
  id: string;
  name: string;
  sellingPrice: number;
  costOfMaterials: number;
  sewing: number;
  outsourcedSewing: number;
  packaging: number;
  productionCosts: number; // Other production fixed costs
  managerPercent: number;
  acquiringPercent: number;
  advertisingPercent: number;
  salesTaxPercent: number;
  loanPercent: number;
  plannedQuantity: number;
  sourceScenarioId?: string;
  // Detailed breakdown
  fabric?: {
    main: number;
    lining: number;
    padding: number;
  };
  accessories?: {
    lock: number;
    eyelets: number;
    fixators: number;
    application: number;
    waistElastic: number;
    embroidery: number;
    hatElastic: number;
  };
  packagingDetails?: {
    postcard: number;
    label: number;
    box: number;
    case: number;
    sticker: number;
    smallSticker: number;
    shuber: number;
    zipBag: number;
  };
  fixedCosts?: {
    salary: number;
    rent: number;
    internet: number;
    water: number;
    other: number;
  };
  adsMetrics?: {
    views: number;
    costPerSale: number;
  };
}

export interface CalculationResults {
  effectiveMaterialsCost: number;
  effectivePackagingCost: number;
  totalVariableCosts: number;
  managerCost: number;
  acquiringCost: number;
  advertisingCost: number;
  salesTaxCost: number;
  loanCost: number;
  totalCostsPerItem: number;
  profitPerItem: number;
  netProfitMargin: number;
  plannedRevenue: number;
  plannedProfit: number;
  totalMonthlyFixedCosts: number;
  annualRevenue: number;
  annualGrossProfit: number;
  annualNetProfit: number;
  maxAdCostPerSale: number;
}
