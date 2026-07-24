import * as XLSX from 'xlsx'

/**
 * Exporta filas a un archivo Excel real (.xlsx) y dispara la descarga.
 *
 * Sustituye a la exportación CSV: el cliente pidió «formato Excel», no separado por comas.
 * SheetJS (xlsx) genera un libro nativo que Excel abre sin avisos de formato.
 *
 * @param {object[]} rows   filas ya aplanadas: cada objeto es una fila; sus claves son los encabezados.
 * @param {object} [options]
 * @param {string} [options.fileName='reporte.xlsx'] nombre del archivo (se le añade .xlsx si falta).
 * @param {string} [options.sheetName='Datos'] nombre de la hoja.
 * @param {string[]} [options.headers] orden explícito de las columnas (si se omite, se toma de la 1ª fila).
 */
export function exportToXlsx(rows, options = {}) {
  const { fileName = 'reporte.xlsx', sheetName = 'Datos', headers } = options

  const safeRows = Array.isArray(rows) ? rows : []
  const columns = headers && headers.length ? headers : Object.keys(safeRows[0] || {})

  // json_to_sheet respeta el orden de `header` y rellena las celdas faltantes como vacías.
  const worksheet = XLSX.utils.json_to_sheet(safeRows, { header: columns })

  // Ancho de columna automático y razonable según el contenido (con techo para no desbordar).
  worksheet['!cols'] = columns.map((col) => {
    const longest = safeRows.reduce((max, row) => {
      const value = row[col] == null ? '' : String(row[col])
      return Math.max(max, value.length)
    }, String(col).length)
    return { wch: Math.min(Math.max(longest + 2, 10), 48) }
  })

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31)) // Excel: máx 31 chars

  const name = fileName.toLowerCase().endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
  // writeFile arma el binario y dispara la descarga en el navegador.
  XLSX.writeFile(workbook, name)
}
