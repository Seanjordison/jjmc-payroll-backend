// utils/payrollCalculations.js
// Philippine government contribution calculations.
// Mirrors the frontend payrollCalculations.js exactly so results are consistent.

/**
 * SSS employee contribution table (2024).
 * @param {number} grossPay
 * @returns {number}
 */
function calculateSSS(grossPay) {
  const gross = parseFloat(grossPay);
  if (gross < 4250)          return 180.00;
  if (gross <= 4749.99)      return 202.50;
  if (gross <= 5249.99)      return 225.00;
  if (gross <= 5749.99)      return 247.50;
  if (gross <= 6249.99)      return 270.00;
  if (gross <= 6749.99)      return 292.50;
  if (gross <= 7249.99)      return 315.00;
  if (gross <= 7749.99)      return 337.50;
  if (gross <= 8249.99)      return 360.00;
  if (gross <= 8749.99)      return 382.50;
  if (gross <= 9249.99)      return 405.00;
  if (gross <= 9749.99)      return 427.50;
  if (gross <= 10249.99)     return 450.00;
  if (gross <= 10749.99)     return 472.50;
  if (gross <= 11249.99)     return 495.00;
  if (gross <= 11749.99)     return 517.50;
  if (gross <= 12249.99)     return 540.00;
  if (gross <= 12749.99)     return 562.50;
  if (gross <= 13249.99)     return 585.00;
  if (gross <= 13749.99)     return 607.50;
  if (gross <= 14249.99)     return 630.00;
  if (gross <= 14749.99)     return 652.50;
  if (gross <= 15249.99)     return 675.00;
  if (gross <= 15749.99)     return 697.50;
  if (gross <= 16249.99)     return 720.00;
  if (gross <= 16749.99)     return 742.50;
  if (gross <= 17249.99)     return 765.00;
  if (gross <= 17749.99)     return 787.50;
  if (gross <= 18249.99)     return 810.00;
  if (gross <= 18749.99)     return 832.50;
  if (gross <= 19249.99)     return 855.00;
  if (gross <= 19749.99)     return 877.50;
  if (gross <= 20249.99)     return 900.00;
  if (gross <= 20749.99)     return 922.50;
  if (gross <= 21249.99)     return 945.00;
  if (gross <= 21749.99)     return 967.50;
  if (gross <= 22249.99)     return 990.00;
  if (gross <= 22749.99)     return 1012.50;
  if (gross <= 23249.99)     return 1035.00;
  if (gross <= 23749.99)     return 1057.50;
  if (gross <= 24249.99)     return 1080.00;
  if (gross <= 24749.99)     return 1102.50;
  if (gross <= 25249.99)     return 1125.00;
  if (gross <= 25749.99)     return 1147.50;
  if (gross <= 26249.99)     return 1170.00;
  if (gross <= 26749.99)     return 1192.50;
  if (gross <= 27249.99)     return 1215.00;
  if (gross <= 27749.99)     return 1237.50;
  if (gross <= 28249.99)     return 1260.00;
  if (gross <= 28749.99)     return 1282.50;
  if (gross <= 29249.99)     return 1305.00;
  if (gross <= 29749.99)     return 1327.50;
  return 1350.00;
}

/**
 * PhilHealth 2024: 5% of gross, floored at ₱500, capped at ₱5,000.
 * @param {number} grossPay
 * @returns {number}
 */
function calculatePhilHealth(grossPay) {
  const gross = parseFloat(grossPay);
  if (gross <= 10000)  return 500.00;
  if (gross >= 100000) return 5000.00;
  return Math.round(gross * 0.05 * 100) / 100;
}

/**
 * Pag-IBIG: fixed ₱200.
 * @returns {number}
 */
function calculatePagIBIG() {
  return 200.00;
}

/**
 * BIR monthly withholding tax — TRAIN Law table.
 * @param {number} grossPay  monthly gross pay
 * @returns {number}
 */
function calculateBIRTax(grossPay) {
  const gross = parseFloat(grossPay);
  if (gross <= 20833)  return 0.00;
  if (gross <= 33332)  return (gross - 20833) * 0.15;
  if (gross <= 66666)  return 1875.00  + (gross - 33333) * 0.20;
  if (gross <= 166666) return 8541.80  + (gross - 66667) * 0.25;
  if (gross <= 666666) return 33541.80 + (gross - 166667) * 0.30;
  return 153541.80 + (gross - 666667) * 0.35;
}

/**
 * Compute all deductions for a single employee row.
 * @param {number} grossPay  monthly gross pay
 * @returns {{ sss, phic, hdmf, bir, netPay }}
 */
function calculateDeductions(grossPay) {
  const gross = parseFloat(grossPay);
  const sss   = calculateSSS(gross);
  const phic  = calculatePhilHealth(gross);
  const hdmf  = calculatePagIBIG();
  const bir   = calculateBIRTax(gross);
  const net   = gross - sss - phic - hdmf - bir;

  return {
    sss:    Math.round(sss   * 100) / 100,
    phic:   Math.round(phic  * 100) / 100,
    hdmf:   Math.round(hdmf  * 100) / 100,
    bir:    Math.round(bir   * 100) / 100,
    netPay: Math.round(net   * 100) / 100,
  };
}

/**
 * Compute monthly gross pay for a CSV row.
 * Uses grossPay if provided; otherwise ratePerHour × hoursWorked.
 * @param {{ grossPay?, ratePerHour?, hoursWorked? }} row
 * @returns {number}
 */
function getMonthlyGrossPay(row) {
  const providedGross = parseFloat(row.grossPay);
  if (providedGross > 0) return Math.round(providedGross * 100) / 100;
  return Math.round(parseFloat(row.ratePerHour) * parseFloat(row.hoursWorked) * 100) / 100;
}

/**
 * Process an entire array of employee rows and attach deduction fields.
 * @param {Array} rows
 * @returns {Array}
 */
function processEmployees(rows) {
  return rows.map((row) => {
    const gross = getMonthlyGrossPay(row);
    const deductions = calculateDeductions(gross);
    return { ...row, grossPay: gross, ...deductions };
  });
}

module.exports = {
  calculateSSS,
  calculatePhilHealth,
  calculatePagIBIG,
  calculateBIRTax,
  calculateDeductions,
  getMonthlyGrossPay,
  processEmployees,
};
