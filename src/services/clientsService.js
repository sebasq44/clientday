/**
 * clientsService — base de clientes de la empresa (importada del Excel «Lista de clientes General»).
 *
 * Columnas del Excel: Codigo, Nombre (razón social), Cedula (con la que factura), Vendedor (= asesor).
 * En el formulario el cliente solo digita su CÉDULA; con ella se autocompletan empresa, código y
 * asesor. La cédula es única, así que se usa como ID del documento (solo dígitos).
 *
 * Colección: clients/{cedula} = { codigo, nombre, cedula, vendedor }
 */
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  writeBatch,
} from 'firebase/firestore'
import * as XLSX from 'xlsx'

import { db } from '../lib/firebase'
import { COL } from '../lib/constants'
import { clean, onlyDigits } from '../lib/format'

/** Un lote de Firestore admite 500 operaciones; dejamos margen. */
const BATCH_SIZE = 400

/** Toma la primera columna cuyo encabezado coincida (sin importar mayúsculas/espacios). */
function pick(row, ...names) {
  const keys = Object.keys(row)
  for (const name of names) {
    const key = keys.find((k) => k.trim().toLowerCase() === name.toLowerCase())
    if (key != null) return row[key]
  }
  return ''
}

/**
 * Lee un archivo Excel (ArrayBuffer) y devuelve las filas normalizadas de clientes.
 * Tolera variaciones en los encabezados (Codigo/Código, Cedula/Cédula…).
 * @returns {{ codigo, nombre, cedula, vendedor }[]}
 */
export function parseClientsWorkbook(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) throw new Error('El archivo no tiene ninguna hoja de datos.')

  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  return raw
    .map((row) => ({
      codigo: clean(pick(row, 'Codigo', 'Código', 'codigo')),
      nombre: clean(pick(row, 'Nombre', 'nombre')),
      cedula: onlyDigits(pick(row, 'Cedula', 'Cédula', 'cedula')),
      vendedor: clean(pick(row, 'Vendedor', 'vendedor', 'Asesor', 'asesor')),
    }))
    .filter((c) => c.cedula) // sin cédula no se puede usar como clave
}

/**
 * Importa (o actualiza) la base de clientes en Firestore, en lotes. Es un upsert por cédula:
 * volver a importar una lista actualizada pisa los datos viejos de cada cliente.
 *
 * @param {{codigo,nombre,cedula,vendedor}[]} rows
 * @param {(done:number, total:number) => void} [onProgress]
 * @returns {Promise<{ imported: number, duplicates: number }>}
 */
export async function importClients(rows, onProgress = () => {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('No hay filas de clientes para importar. Revisa el archivo.')
  }

  // Deduplica por cédula (la última gana), para no gastar escrituras repetidas.
  const byCedula = new Map()
  rows.forEach((r) => {
    const cedula = onlyDigits(r.cedula)
    if (cedula) byCedula.set(cedula, { ...r, cedula })
  })
  const unique = [...byCedula.values()]
  const duplicates = rows.length - unique.length

  let imported = 0
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = writeBatch(db)
    for (const c of unique.slice(i, i + BATCH_SIZE)) {
      batch.set(doc(db, COL.CLIENTS, c.cedula), {
        codigo: c.codigo,
        nombre: c.nombre,
        cedula: c.cedula,
        vendedor: c.vendedor,
      })
    }
    await batch.commit()
    imported += Math.min(BATCH_SIZE, unique.length - i)
    onProgress(imported, unique.length)
  }

  return { imported, duplicates }
}

/**
 * Busca un cliente por su cédula. Devuelve null si no existe.
 * @param {string} cedula
 * @returns {Promise<{ codigo, nombre, cedula, vendedor } | null>}
 */
export async function lookupClientByCedula(cedula) {
  const id = onlyDigits(cedula)
  if (!id) return null

  const snap = await getDoc(doc(db, COL.CLIENTS, id))
  if (!snap.exists()) return null
  return { cedula: id, ...snap.data() }
}

/** Cuántos clientes hay cargados (para mostrarlo en el panel de administración). */
export async function getClientsCount() {
  try {
    const snap = await getCountFromServer(collection(db, COL.CLIENTS))
    return snap.data().count
  } catch (error) {
    console.error('[clientsService] getClientsCount', error)
    return 0
  }
}
