import { UnitEconomics, CalculationResults } from "../types";

export function calculateUnitEconomics(data: UnitEconomics): CalculationResults {
  const {
    sellingPrice,
    costOfMaterials,
    sewing,
    outsourcedSewing,
    packaging,
    productionCosts,
    managerPercent,
    acquiringPercent,
    advertisingPercent,
    salesTaxPercent,
    loanPercent,
    plannedQuantity,
  } = data;

  // Calculate detailed costs if they exist
  const fabricCost = data.fabric 
    ? ((data.fabric.main || 0) + (data.fabric.lining || 0) + (data.fabric.padding || 0)) 
    : 0;
  
  const accessoriesCost = data.accessories 
    ? Object.values(data.accessories).reduce((acc, val) => acc + (Number(val) || 0), 0) 
    : 0;
  const detailedPackagingCost = data.packagingDetails ? Object.values(data.packagingDetails).reduce((a, b) => a + b, 0) : 0;
  
  // Calculate total monthly fixed costs
  const totalMonthlyFixedCosts = data.fixedCosts 
    ? Object.values(data.fixedCosts).reduce((a, b) => a + b, 0) 
    : 0;

  // Use detailed costs if they are greater than 0, otherwise fallback to the top-level fields
  const finalMaterialsCost = fabricCost + accessoriesCost > 0 ? fabricCost + accessoriesCost : costOfMaterials;
  const finalPackagingCost = detailedPackagingCost > 0 ? detailedPackagingCost : packaging;
  
  // Total fixed costs for the calculation (production costs + monthly fixed costs)
  const totalFixedCosts = productionCosts + totalMonthlyFixedCosts;

  // Direct costs per item
  // Add ads cost per sale if provided
  const adsCostPerSale = data.adsMetrics?.costPerSale || 0;
  const directCosts = finalMaterialsCost + sewing + outsourcedSewing + finalPackagingCost + adsCostPerSale;
  
  // Allocated production costs (if any)
  const allocatedProductionCost = plannedQuantity > 0 ? totalFixedCosts / plannedQuantity : 0;

  // Percentage based costs
  const managerCost = (sellingPrice * managerPercent) / 100;
  const acquiringCost = (sellingPrice * acquiringPercent) / 100;
  const advertisingCost = (sellingPrice * advertisingPercent) / 100;
  const salesTaxCost = (sellingPrice * salesTaxPercent) / 100;
  const loanCost = (sellingPrice * loanPercent) / 100;

  const totalCostsPerItem = directCosts + allocatedProductionCost + managerCost + acquiringCost + advertisingCost + salesTaxCost + loanCost;
  const profitPerItem = sellingPrice - totalCostsPerItem;
  const netProfitMargin = sellingPrice > 0 ? (profitPerItem / sellingPrice) * 100 : 0;

  // Max we can spend on ads to have 0 profit
  const maxAdCostPerSale = profitPerItem + adsCostPerSale;

  const plannedRevenue = sellingPrice * plannedQuantity;
  const plannedProfit = profitPerItem * plannedQuantity;

  // Annual projections (assuming plannedQuantity is monthly)
  const annualRevenue = plannedRevenue * 12;
  const annualGrossProfit = (sellingPrice - directCosts - managerCost - acquiringCost - advertisingCost - salesTaxCost - loanCost) * plannedQuantity * 12;
  const annualNetProfit = plannedProfit * 12;

  return {
    effectiveMaterialsCost: finalMaterialsCost,
    effectivePackagingCost: finalPackagingCost,
    totalVariableCosts: directCosts + allocatedProductionCost,
    managerCost,
    acquiringCost,
    advertisingCost,
    salesTaxCost,
    loanCost,
    totalCostsPerItem,
    profitPerItem,
    netProfitMargin,
    plannedRevenue,
    plannedProfit,
    totalMonthlyFixedCosts,
    annualRevenue,
    annualGrossProfit,
    annualNetProfit,
    maxAdCostPerSale,
  };
}
