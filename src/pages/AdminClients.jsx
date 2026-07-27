import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  FileSpreadsheet,
  Search,
  SearchX,
  TriangleAlert,
  Upload,
  UploadCloud,
  Users,
  X,
} from 'lucide-react'

import { Button, Card, EmptyState, Input, Spinner, useToast } from '../components/ui'
import {
  getClientsCount,
  importClients,
  lookupClientByCedula,
  parseClientsWorkbook,
} from '../services/clientsService'
import { onlyDigits } from '../lib/format'

/** Cuántas filas de la vista previa mostramos antes de importar. */
const PREVIEW_ROWS = 5

export default function AdminClients() {
  const toast = useToast()

  // --- Conteo actual de clientes cargados ---
  const [count, setCount] = useState(null)
  const [loadingCount, setLoadingCount] = useState(true)

  // --- Lectura del archivo / vista previa ---
  const [dragging, setDragging] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [rows, setRows] = useState(null)
  const [fileName, setFileName] = useState('')
  const fileInputRef = useRef(null)

  // --- Importación ---
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  // --- Buscador de verificación ---
  const [searchCedula, setSearchCedula] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResult, setSearchResult] = useState(null) // null = sin buscar; { client: obj|null }

  // ---------------------------------------------------------------- Conteo

  const refreshCount = useCallback(async () => {
    setLoadingCount(true)
    try {
      const total = await getClientsCount()
      setCount(total)
    } finally {
      setLoadingCount(false)
    }
  }, [])

  useEffect(() => {
    refreshCount()
  }, [refreshCount])

  // ---------------------------------------------------------------- Archivo

  const resetPreview = () => {
    setRows(null)
    setFileName('')
    setParseError('')
    setProgress({ done: 0, total: 0 })
  }

  const handleFile = useCallback(
    async (file) => {
      if (!file || importing) return

      resetPreview()
      setParsing(true)
      setFileName(file.name)
      try {
        const buffer = await file.arrayBuffer()
        const parsed = parseClientsWorkbook(buffer)
        if (!parsed.length) {
          setParseError(
            'No encontramos filas válidas. Revisa que el Excel tenga las columnas Codigo, Nombre, Cedula y Vendedor, y que cada fila tenga cédula.',
          )
          toast.error('El archivo no tiene clientes con cédula válida.')
          return
        }
        setRows(parsed)
      } catch (err) {
        setParseError(err.message)
        toast.error(err.message)
      } finally {
        setParsing(false)
      }
    },
    [importing, toast],
  )

  const handleDrop = (event) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer?.files?.[0]
    if (file) handleFile(file)
  }

  const handleFileInput = (event) => {
    const file = event.target.files?.[0]
    // Limpiamos el input para poder volver a elegir el mismo archivo si hace falta.
    event.target.value = ''
    if (file) handleFile(file)
  }

  // ---------------------------------------------------------------- Importar

  const handleImport = async () => {
    if (!rows || !rows.length) return

    setImporting(true)
    setProgress({ done: 0, total: rows.length })
    try {
      const { imported, duplicates } = await importClients(rows, (done, total) =>
        setProgress({ done, total }),
      )
      toast.success(
        `Se importaron ${imported} clientes.` +
          (duplicates > 0
            ? ` Se omitieron ${duplicates} ${
                duplicates === 1 ? 'cédula repetida' : 'cédulas repetidas'
              } (se conservó la última).`
            : ''),
      )
      resetPreview()
      await refreshCount()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setImporting(false)
    }
  }

  // ---------------------------------------------------------------- Buscar

  const handleSearch = async (event) => {
    event?.preventDefault()
    const cedula = onlyDigits(searchCedula)
    if (!cedula) {
      toast.info('Escribe una cédula para verificar.')
      return
    }

    setSearching(true)
    setSearchResult(null)
    try {
      const client = await lookupClientByCedula(cedula)
      setSearchResult({ client })
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSearching(false)
    }
  }

  // ---------------------------------------------------------------- Render

  const percent =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-xl font-extrabold uppercase tracking-wide text-belen-blue sm:text-2xl">
          Clientes
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
          Carga la base de clientes de la empresa desde un Excel con las columnas{' '}
          <strong className="text-belen-ink">Codigo</strong>,{' '}
          <strong className="text-belen-ink">Nombre</strong>,{' '}
          <strong className="text-belen-ink">Cedula</strong> y{' '}
          <strong className="text-belen-ink">Vendedor</strong>. Con estos datos, el formulario
          autocompleta la empresa, el código y el asesor a partir de la cédula que digita el cliente.
        </p>
      </header>

      {/* ------------------------------------------------ Conteo actual */}
      <Card>
        <div className="flex items-center gap-4">
          <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-belen-blue/5 ring-1 ring-belen-blue/10">
            <Users className="h-7 w-7 text-belen-blue" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            {loadingCount ? (
              <div className="flex items-center gap-2 text-belen-blue">
                <Spinner size="sm" />
                <span className="text-sm font-medium text-slate-500">Contando clientes…</span>
              </div>
            ) : (
              <p className="font-display text-3xl font-extrabold leading-none text-belen-blue sm:text-4xl">
                {(count ?? 0).toLocaleString('es-CR')}
              </p>
            )}
            <p className="mt-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {(count ?? 0) === 1 ? 'Cliente cargado' : 'Clientes cargados'}
            </p>
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------ Importar */}
      <Card
        title="Importar desde Excel"
        subtitle="Sube el archivo «Lista de clientes General» para actualizar la base."
      >
        {/* Aviso de sobrescritura (upsert) */}
        <div className="mb-4 flex gap-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
          <TriangleAlert
            className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
            aria-hidden="true"
          />
          <p className="min-w-0 text-sm leading-snug text-amber-800">
            Importar <strong>actualiza y sobrescribe</strong> los clientes que ya existen (se
            emparejan por cédula). No se borran los clientes que no vengan en el archivo.
          </p>
        </div>

        {/* Zona de arrastrar y soltar / seleccionar archivo */}
        {!rows && (
          <div
            role="button"
            tabIndex={0}
            aria-disabled={parsing || undefined}
            onClick={() => !parsing && fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                if (!parsing) fileInputRef.current?.click()
              }
            }}
            onDragEnter={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={(event) => {
              event.preventDefault()
              setDragging(false)
            }}
            onDrop={handleDrop}
            className={[
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-belen-orange focus-visible:ring-offset-2',
              parsing ? 'cursor-wait opacity-70' : '',
              dragging
                ? 'border-belen-orange bg-belen-orange/5'
                : 'border-belen-blue/25 bg-belen-cream/60 hover:border-belen-orange hover:bg-belen-orange/5',
            ].join(' ')}
          >
            {parsing ? (
              <Spinner size="lg" className="text-belen-blue" />
            ) : (
              <UploadCloud className="h-9 w-9 text-belen-blue/60" aria-hidden="true" />
            )}

            <p className="text-sm font-semibold text-belen-blue">
              {parsing ? 'Leyendo el archivo…' : 'Arrastra el Excel aquí'}
            </p>
            <p className="text-xs text-slate-500">
              o haz clic para elegir un archivo (.xlsx o .xls)
            </p>

            <span className="pointer-events-none mt-1 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-belen-blue ring-1 ring-inset ring-belen-blue/20">
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              Seleccionar archivo
            </span>

            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="sr-only"
              onChange={handleFileInput}
              tabIndex={-1}
            />
          </div>
        )}

        {parseError && !rows && (
          <div className="mt-4 flex gap-3 rounded-xl bg-red-50 p-3 ring-1 ring-red-200">
            <TriangleAlert
              className="mt-0.5 h-5 w-5 shrink-0 text-red-600"
              aria-hidden="true"
            />
            <p role="alert" className="min-w-0 text-sm leading-snug text-red-700">
              {parseError}
            </p>
          </div>
        )}

        {/* Vista previa + confirmación */}
        {rows && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-belen-cream/70 px-4 py-3 ring-1 ring-belen-blue/10">
              <div className="flex min-w-0 items-center gap-3">
                <FileSpreadsheet
                  className="h-6 w-6 shrink-0 text-belen-blue"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-belen-ink">
                    {fileName || 'Archivo seleccionado'}
                  </p>
                  <p className="text-xs text-slate-500">
                    Se detectaron{' '}
                    <strong className="text-belen-blue">
                      {rows.length.toLocaleString('es-CR')}
                    </strong>{' '}
                    {rows.length === 1 ? 'cliente' : 'clientes'} con cédula válida.
                  </p>
                </div>
              </div>

              {!importing && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={X}
                  onClick={resetPreview}
                  aria-label="Descartar el archivo seleccionado"
                >
                  Descartar
                </Button>
              )}
            </div>

            {/* Tabla con las primeras filas */}
            <div className="overflow-x-auto rounded-xl ring-1 ring-belen-blue/10">
              <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-belen-blue/5 text-xs font-bold uppercase tracking-wide text-belen-blue">
                    <th className="px-3 py-2.5">Codigo</th>
                    <th className="px-3 py-2.5">Nombre</th>
                    <th className="px-3 py-2.5">Cedula</th>
                    <th className="px-3 py-2.5">Vendedor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-belen-blue/10">
                  {rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                    <tr key={`${row.cedula}-${index}`} className="text-belen-ink">
                      <td className="whitespace-nowrap px-3 py-2 font-medium">
                        {row.codigo || '—'}
                      </td>
                      <td className="px-3 py-2">{row.nombre || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                        {row.cedula || '—'}
                      </td>
                      <td className="px-3 py-2">{row.vendedor || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {rows.length > PREVIEW_ROWS && (
              <p className="text-xs text-slate-500">
                Mostrando las primeras {PREVIEW_ROWS} de{' '}
                {rows.length.toLocaleString('es-CR')} filas.
              </p>
            )}

            {/* Barra de progreso durante la importación */}
            {importing && (
              <div>
                <div
                  className="h-2.5 w-full overflow-hidden rounded-full bg-belen-blue/10"
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Progreso de la importación de clientes"
                >
                  <div
                    className="h-full rounded-full bg-belen-orange transition-[width] duration-200 ease-out"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs font-medium text-slate-500">
                  Importando… {progress.done.toLocaleString('es-CR')} de{' '}
                  {progress.total.toLocaleString('es-CR')} ({percent}%)
                </p>
              </div>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="ghost"
                onClick={resetPreview}
                disabled={importing}
                className="w-full sm:w-auto"
              >
                Cancelar
              </Button>
              <Button
                icon={UploadCloud}
                loading={importing}
                onClick={handleImport}
                className="w-full sm:w-auto"
              >
                Importar {rows.length.toLocaleString('es-CR')}{' '}
                {rows.length === 1 ? 'cliente' : 'clientes'}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------ Verificar */}
      <Card
        title="Verificar una cédula"
        subtitle="Comprueba que la carga quedó bien buscando un cliente por su cédula."
      >
        <form
          onSubmit={handleSearch}
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
        >
          <div className="flex-1">
            <Input
              label="Cédula del cliente"
              inputMode="numeric"
              value={searchCedula}
              onChange={(event) => setSearchCedula(onlyDigits(event.target.value))}
              placeholder="Ej. 102340567"
              autoComplete="off"
            />
          </div>
          <Button
            type="submit"
            icon={Search}
            loading={searching}
            className="w-full sm:mt-[1.9rem] sm:w-auto"
          >
            Buscar
          </Button>
        </form>

        {searchResult && (
          <div className="mt-4">
            {searchResult.client ? (
              <div className="flex gap-3 rounded-xl bg-emerald-50 p-4 ring-1 ring-emerald-200">
                <CheckCircle2
                  className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600"
                  aria-hidden="true"
                />
                <div className="min-w-0 space-y-1.5">
                  <p className="text-sm font-bold text-emerald-800">Cliente encontrado</p>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-emerald-900 sm:grid-cols-2">
                    <div className="flex gap-1.5">
                      <dt className="font-semibold">Empresa:</dt>
                      <dd className="min-w-0 break-words">
                        {searchResult.client.nombre || '—'}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="font-semibold">Código:</dt>
                      <dd className="min-w-0 break-words">
                        {searchResult.client.codigo || '—'}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="font-semibold">Cédula:</dt>
                      <dd className="min-w-0 break-words tabular-nums">
                        {searchResult.client.cedula || '—'}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="font-semibold">Asesor:</dt>
                      <dd className="min-w-0 break-words">
                        {searchResult.client.vendedor || '—'}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={SearchX}
                title="No encontrado"
                description="Ninguna cédula de la base coincide con la que buscaste. Verifica el número o vuelve a importar el Excel."
              />
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
