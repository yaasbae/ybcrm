import { UnitEconomics } from "./types";

export const INITIAL_DATA: UnitEconomics[] = [
  {
    id: "1",
    name: "Новое изделие",
    sellingPrice: 15000,
    costOfMaterials: 3000,
    sewing: 1500,
    outsourcedSewing: 0,
    packaging: 200,
    productionCosts: 0,
    managerPercent: 4.0,
    acquiringPercent: 3.0,
    advertisingPercent: 5.0,
    salesTaxPercent: 3.0,
    loanPercent: 0,
    plannedQuantity: 100,
    fixedCosts: {
      salary: 0,
      rent: 0,
      internet: 0,
      water: 0,
      other: 0
    },
    adsMetrics: {
      views: 0,
      costPerSale: 0
    }
  },
];
