export interface BudgetConfig {
  maxCostPerTurn?: number
  maxCostPerDay?: number
}

export interface BudgetCheckResult {
  allowed: boolean
  reason?: string
}

export function checkTurnBudget(currentCost: number, maxCostPerTurn?: number): BudgetCheckResult {
  if (maxCostPerTurn == null || maxCostPerTurn <= 0) {
    return { allowed: true }
  }
  if (currentCost >= maxCostPerTurn) {
    return {
      allowed: false,
      reason: `Turn cost $${currentCost.toFixed(4)} exceeds budget $${maxCostPerTurn.toFixed(4)}`,
    }
  }
  return { allowed: true }
}

export function checkDailyBudget(currentDayCost: number, maxCostPerDay?: number): BudgetCheckResult {
  if (maxCostPerDay == null || maxCostPerDay <= 0) {
    return { allowed: true }
  }
  if (currentDayCost >= maxCostPerDay) {
    return {
      allowed: false,
      reason: `Daily cost $${currentDayCost.toFixed(4)} exceeds budget $${maxCostPerDay.toFixed(4)}`,
    }
  }
  return { allowed: true }
}
