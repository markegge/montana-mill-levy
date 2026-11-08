import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapGeoJSONFeature, MapMouseEvent } from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { TILES_BASE } from '../data/load'
import type { Meta, ParcelProps, Year } from '../data/types'
import { fmtMills, fmtUSD } from '../format'
import {
  addedLabel, buildingColor, moneyLabel, parcelFillColor, parcelFillOpacity, yf, type ColorMode,
} from './style'

export const BASEMAP = 'https://tiles.openfreemap.org/styles/positron'
export const HOME_VIEW = { center: [-111.04, 45.68] as [number, number], zoom: 12.5, pitch: 45, bearing: 0 }
/** Where the header's county switcher flies to (each county's main city). */
export const COUNTY_VIEWS: Record<string, { center: [number, number]; zoom: number }> = {
  gallatin: { center: HOME_VIEW.center, zoom: 12.5 },
  yellowstone: { center: [-108.53, 45.78], zoom: 12.5 },
}

let protocolAdded = false
function ensureProtocol() {
  if (protocolAdded) return
  // MapLibre 6 resolves its worker relative to import.meta.url, which bundling breaks; point it at the emitted asset.
  maplibregl.setWorkerUrl(workerUrl)
  const protocol = new Protocol()
  maplibregl.addProtocol('pmtiles', protocol.tile)
  protocolAdded = true
}

function absUrl(u: string) {
  return new URL(u, window.location.href).href
}

export interface PickEvent {
  pid: string
  parcel: ParcelProps | null
  building: Record<string, unknown> | null
  /** Condo unit to highlight in the master parcel's unit list, e.g. "151 COVEY #D" */
  unit?: string
}

export interface ViewState { zoom: number; lat: number; lon: number; pitch: number; bearing: number }

interface Options {
  container: HTMLElement
  meta: Meta
  view?: ViewState
  onPick: (e: PickEvent | null) => void
  onMove: (v: ViewState) => void
  onReady: () => void
}

export class MapController {
  map: maplibregl.Map
  private meta: Meta
  private mode: ColorMode = 'tax'
  private year: Year = '2026'
  private addedBreaks: number[] = [1, 2, 3, 4, 5, 6]
  private mills = 5
  private hoverPid: string | null = null
  private pickedPid: string | null = null
  private selPids: string[] = []
  private popup: maplibregl.Popup
  private drawing = false
  private draw: { stop(): void } | null = null
  private ready = false
  private opts: Options

  constructor(opts: Options) {
    ensureProtocol()
    this.opts = opts
    this.meta = opts.meta
    const v = opts.view
    this.map = new maplibregl.Map({
      container: opts.container,
      style: BASEMAP,
      center: v ? [v.lon, v.lat] : HOME_VIEW.center,
      zoom: v?.zoom ?? HOME_VIEW.zoom,
      pitch: v?.pitch ?? HOME_VIEW.pitch,
      bearing: v?.bearing ?? HOME_VIEW.bearing,
      maxPitch: 70,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
    })
    this.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right')
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right')
    this.map.addControl(
      new maplibregl.AttributionControl({ compact: true, customAttribution: this.meta.attribution }),
      'bottom-right',
    )
    this.popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'hover-tip', maxWidth: '280px' })
    this.map.on('load', () => this.onLoad())
    const emitMove = () => {
      const c = this.map.getCenter()
      opts.onMove({ zoom: this.map.getZoom(), lat: c.lat, lon: c.lng, pitch: this.map.getPitch(), bearing: this.map.getBearing() })
    }
    this.map.on('moveend', emitMove)
    this.map.once('load', emitMove)
  }

  private onLoad() {
    const map = this.map
    const layers = map.getStyle().layers ?? []
    // Only our Overture extrusions should read as 3D structures.
    for (const l of layers) {
      if ('source-layer' in l && l['source-layer'] === 'building') map.setLayoutProperty(l.id, 'visibility', 'none')
    }
    const firstSymbol = layers.find((l) => l.type === 'symbol')?.id

    map.addSource('parcels', {
      type: 'vector',
      url: `pmtiles://${absUrl(`${TILES_BASE}/parcels.pmtiles`)}`,
      promoteId: 'pid',
    })
    map.addSource('buildings', {
      type: 'vector',
      url: `pmtiles://${absUrl(`${TILES_BASE}/buildings.pmtiles`)}`,
      promoteId: 'bid',
    })
    map.addSource('area', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

    map.addLayer({
      id: 'parcels-fill', type: 'fill', source: 'parcels', 'source-layer': 'parcels', minzoom: 9,
      paint: { 'fill-color': EXEMPT_FALLBACK, 'fill-opacity': 0.58 },
    }, firstSymbol)
    map.addLayer({
      id: 'parcels-line', type: 'line', source: 'parcels', 'source-layer': 'parcels', minzoom: 14,
      paint: {
        'line-color': '#5b4a3a',
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0.12, 17, 0.35],
        'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.3, 18, 1],
      },
    }, firstSymbol)
    map.addLayer({
      id: 'parcels-hl', type: 'line', source: 'parcels', 'source-layer': 'parcels', minzoom: 9,
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'picked'], false], '#14110f', '#3a2f27'],
        'line-width': ['case', ['boolean', ['feature-state', 'picked'], false], 2.5, 1.6],
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'picked'], false], 1,
          ['boolean', ['feature-state', 'hover'], false], 0.8,
          0,
        ],
      },
    }, firstSymbol)
    map.addLayer({
      id: 'area-fill', type: 'fill', source: 'area',
      paint: { 'fill-color': '#1d3b66', 'fill-opacity': 0.04 },
    }, firstSymbol)
    map.addLayer({
      id: 'area-line-halo', type: 'line', source: 'area',
      paint: { 'line-color': '#ffffff', 'line-width': 5, 'line-opacity': 0.7 },
    })
    map.addLayer({
      id: 'area-line', type: 'line', source: 'area',
      paint: { 'line-color': '#1d3b66', 'line-width': 2.2, 'line-dasharray': [3, 1.5] },
    })
    map.addLayer({
      id: 'buildings-3d', type: 'fill-extrusion', source: 'buildings', 'source-layer': 'buildings', minzoom: 13,
      paint: {
        'fill-extrusion-color': '#c9c6bd',
        'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 13.6, ['coalesce', ['get', 'h'], 5]],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.9,
        'fill-extrusion-vertical-gradient': true,
      },
    })
    map.addLayer({
      id: 'parcel-labels', type: 'symbol', source: 'parcels', 'source-layer': 'parcels', minzoom: 16,
      layout: {
        'symbol-placement': 'point',
        'text-field': moneyLabel('tax'),
        'text-font': ['Noto Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 16, 10.5, 19, 13],
        'text-allow-overlap': false,
        'text-padding': 4,
      },
      paint: { 'text-color': '#2a201a', 'text-halo-color': 'rgba(255,252,244,0.95)', 'text-halo-width': 1.6 },
    })
    map.addLayer({
      id: 'building-labels', type: 'symbol', source: 'buildings', 'source-layer': 'buildings', minzoom: 17,
      layout: {
        'symbol-placement': 'point',
        'text-field': moneyLabel('tax_b'),
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-allow-overlap': false,
        'text-padding': 3,
      },
      paint: { 'text-color': '#4a1320', 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.4 },
    })

    // Start the compact attribution collapsed (it opens by default and covers the map on phones).
    this.opts.container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
    map.on('mousemove', (e) => this.onHover(e))
    map.on('mouseout', () => this.clearHover())
    map.on('click', (e) => this.onClick(e))
    this.ready = true
    this.applyStyle()
    this.applySelectionState()
    this.opts.onReady()
  }

  isReady() {
    return this.ready
  }

  private applyStyle() {
    if (!this.ready) return
    const { map, mode, year, meta } = this
    map.setPaintProperty('parcels-fill', 'fill-color', parcelFillColor(mode, year, meta, this.addedBreaks))
    map.setPaintProperty('parcels-fill', 'fill-opacity', parcelFillOpacity(mode))
    map.setPaintProperty('buildings-3d', 'fill-extrusion-color', buildingColor(mode, year, meta))
    map.setPaintProperty('buildings-3d', 'fill-extrusion-opacity', mode === 'added' ? 0.55 : 0.9)
    if (mode === 'added') {
      map.setLayoutProperty('parcel-labels', 'text-field', addedLabel(year, this.mills))
      map.setFilter('parcel-labels', ['>', ['coalesce', ['get', yf('tv', year)], 0], 0])
      map.setPaintProperty('parcel-labels', 'text-opacity', ['case', ['boolean', ['feature-state', 'sel'], false], 1, 0])
    } else {
      map.setPaintProperty('parcel-labels', 'text-opacity', 1)
      map.setLayoutProperty('parcel-labels', 'text-field', moneyLabel(yf('tax', year)))
      map.setFilter('parcel-labels', ['>', ['coalesce', ['get', yf('tax', year)], 0], 0])
    }
    map.setLayoutProperty('building-labels', 'visibility', mode === 'added' || !this.buildingsOn ? 'none' : 'visible')
    map.setLayoutProperty('building-labels', 'text-field', moneyLabel(yf('tax_b', year)))
    map.setFilter('building-labels', ['>', ['coalesce', ['get', yf('tax_b', year)], 0], 0])
  }

  setStyle(mode: ColorMode, year: Year, addedBreaks: number[], mills: number) {
    this.mills = mills
    this.mode = mode
    this.year = year
    this.addedBreaks = addedBreaks
    this.applyStyle()
  }

  private buildingsOn = true

  setBuildingsVisible(on: boolean) {
    this.buildingsOn = on
    if (!this.ready) return
    this.map.setLayoutProperty('buildings-3d', 'visibility', on ? 'visible' : 'none')
    this.applyStyle()
  }

  setArea(features: Feature<Polygon | MultiPolygon>[], fit: boolean, fitBbox?: [number, number, number, number]) {
    const fc: FeatureCollection = { type: 'FeatureCollection', features }
    const apply = () => {
      ;(this.map.getSource('area') as GeoJSONSource | undefined)?.setData(fc)
      const pad = { top: 80, bottom: 80, left: window.innerWidth > 768 ? 440 : 30, right: 60 }
      if (fit && !features.length && fitBbox) this.map.fitBounds(fitBbox, { padding: pad, duration: 900 })
      if (fit && features.length) {
        let [w, s, e, n] = [180, 90, -180, -90]
        const walk = (c: unknown): void => {
          if (typeof (c as number[])[0] === 'number') {
            const [x, y] = c as number[]
            w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y)
          } else (c as unknown[]).forEach(walk)
        }
        features.forEach((f) => walk(f.geometry.coordinates))
        this.map.fitBounds([w, s, e, n], { padding: { top: 80, bottom: 80, left: window.innerWidth > 768 ? 440 : 30, right: 60 }, maxZoom: 15, duration: 900 })
      }
    }
    if (this.ready) apply()
    else this.map.once('load', apply)
  }

  /** Parcels in the calculator selection, for the added-tax choropleth. */
  setSelectedParcels(pids: string[]) {
    this.selPids = pids
    this.applySelectionState()
  }

  private applySelectionState() {
    if (!this.ready) return
    const map = this.map
    map.removeFeatureState({ source: 'parcels', sourceLayer: 'parcels' })
    for (const id of this.selPids) map.setFeatureState({ source: 'parcels', sourceLayer: 'parcels', id }, { sel: true })
    if (this.pickedPid) map.setFeatureState({ source: 'parcels', sourceLayer: 'parcels', id: this.pickedPid }, { picked: true })
    this.hoverPid = null
  }

  setPicked(pid: string | null) {
    if (!this.ready) {
      this.pickedPid = pid
      return
    }
    if (this.pickedPid) this.map.setFeatureState({ source: 'parcels', sourceLayer: 'parcels', id: this.pickedPid }, { picked: false })
    this.pickedPid = pid
    if (pid) this.map.setFeatureState({ source: 'parcels', sourceLayer: 'parcels', id: pid }, { picked: true })
  }

  private setHover(pid: string | null) {
    if (pid === this.hoverPid) return
    if (this.hoverPid) this.map.setFeatureState({ source: 'parcels', sourceLayer: 'parcels', id: this.hoverPid }, { hover: false })
    this.hoverPid = pid
    if (pid) this.map.setFeatureState({ source: 'parcels', sourceLayer: 'parcels', id: pid }, { hover: true })
  }

  private clearHover() {
    this.setHover(null)
    this.popup.remove()
    this.map.getCanvas().style.cursor = ''
  }

  private hit(e: MapMouseEvent): { parcel: MapGeoJSONFeature | null; building: MapGeoJSONFeature | null } {
    const layers = ['buildings-3d', 'parcels-fill'].filter((l) => this.map.getLayer(l) && this.map.getLayoutProperty(l, 'visibility') !== 'none')
    const feats = this.map.queryRenderedFeatures(e.point, { layers })
    return {
      building: feats.find((f) => f.layer.id === 'buildings-3d') ?? null,
      parcel: feats.find((f) => f.layer.id === 'parcels-fill') ?? null,
    }
  }

  private onHover(e: MapMouseEvent) {
    if (this.drawing || window.matchMedia('(hover: none)').matches) return
    const { parcel, building } = this.hit(e)
    const pid = (building?.properties.pid as string | undefined) ?? (parcel?.properties.pid as string | undefined) ?? null
    this.setHover(pid)
    if (!parcel && !building) {
      this.popup.remove()
      this.map.getCanvas().style.cursor = ''
      return
    }
    this.map.getCanvas().style.cursor = 'pointer'
    const y = this.year
    const p = parcel?.properties ?? {}
    let html = ''
    if (building) {
      const b = building.properties
      const bt = b[yf('tax_b', y)] as number | undefined
      const has = bt != null && Number(bt) > 0
      html += `<div class="tip-kicker">Structure</div><div class="tip-big">${has ? fmtUSD(bt) : 'No structure tax'}</div>`
      if (b.share != null && has) html += `<div class="tip-sub">${Math.round(Number(b.share) * 100)}% of the parcel's structure tax</div>`
    }
    if (parcel) {
      const tax = Number(p[yf('tax', y)] ?? 0)
      const addr = (p.addr as string) || 'No situs address'
      html += `<div class="tip-addr">${escapeHtml(addr)}</div>`
      html += tax > 0
        ? `<div class="tip-row"><span>${building ? 'Parcel total' : `TY${y} tax`}</span><b>${fmtUSD(tax)}</b></div><div class="tip-row"><span>Mills</span><b>${fmtMills(Number(p[yf('mills', y)]))}</b></div>`
        : '<div class="tip-sub">Exempt / non-valued</div>'
    }
    this.popup.setLngLat(e.lngLat).setHTML(html).addTo(this.map)
  }

  private onClick(e: MapMouseEvent) {
    if (this.drawing) return
    const { parcel, building } = this.hit(e)
    if (!parcel && !building) {
      this.opts.onPick(null)
      return
    }
    const pid = (building?.properties.pid as string | undefined) ?? (parcel?.properties.pid as string)
    if (!pid) {
      this.opts.onPick(null)
      return
    }
    let parcelProps = parcel && parcel.properties.pid === pid ? (parcel.properties as ParcelProps) : null
    parcelProps ??= this.findParcel(pid)
    this.opts.onPick({ pid, parcel: parcelProps, building: building ? { ...building.properties } : null })
  }

  /** Fly to a point at parcel zoom (keeping the current pitch) and resolve once the tiles there have rendered. */
  flyToPoint(lon: number, lat: number, zoom = 17.5): Promise<void> {
    return new Promise((resolve) => {
      const go = () => {
        // On phones the property sheet covers the lower half, so land the parcel in the upper part of the map.
        const h = this.map.getContainer().clientHeight
        const offset: [number, number] = window.innerWidth < 768 ? [0, -Math.round(h * 0.27)] : [0, 0]
        this.map.flyTo({ center: [lon, lat], zoom, offset, duration: 1400, essential: true })
        this.map.once('moveend', () => {
          // 'idle' fires once the new tiles are loaded and drawn; cap the wait for slow connections.
          const t = setTimeout(resolve, 4000)
          this.map.once('idle', () => { clearTimeout(t); resolve() })
        })
      }
      if (this.ready) go()
      else this.map.once('load', go)
    })
  }

  /** The parcel under a point on screen, if any. */
  parcelAt(lon: number, lat: number): ParcelProps | null {
    if (!this.ready) return null
    const f = this.map.queryRenderedFeatures(this.map.project([lon, lat]), { layers: ['parcels-fill'] })
    return f.length ? (f[0].properties as ParcelProps) : null
  }

  findParcel(pid: string): ParcelProps | null {
    if (!this.ready) return null
    const f = this.map.querySourceFeatures('parcels', { sourceLayer: 'parcels', filter: ['==', ['get', 'pid'], pid] })
    return f.length ? (f[0].properties as ParcelProps) : null
  }

  async startDraw(kind: 'polygon' | 'rectangle', onDone: (f: Feature<Polygon> | null) => void) {
    this.stopDraw()
    const [{ TerraDraw, TerraDrawPolygonMode, TerraDrawRectangleMode }, { TerraDrawMapLibreGLAdapter }] = await Promise.all([
      import('terra-draw'),
      import('terra-draw-maplibre-gl-adapter'),
    ])
    const style = { fillColor: '#33879b' as const, outlineColor: '#1d3b66' as const, fillOpacity: 0.15, outlineWidth: 2 }
    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map: this.map }),
      modes: [
        new TerraDrawPolygonMode({ styles: { ...style, closingPointColor: '#1d3b66', closingPointOutlineColor: '#ffffff' } }),
        new TerraDrawRectangleMode({ styles: style }),
      ],
    })
    draw.start()
    draw.setMode(kind)
    this.drawing = true
    this.popup.remove()
    this.draw = draw
    draw.on('finish', (id) => {
      const f = draw.getSnapshotFeature(id)
      this.stopDraw()
      onDone(f && f.geometry.type === 'Polygon' ? { type: 'Feature', properties: {}, geometry: f.geometry as Polygon } : null)
    })
  }

  stopDraw() {
    if (this.draw) {
      const d = this.draw
      this.draw = null
      // Defer so terra-draw finishes its own event handling before teardown.
      setTimeout(() => d.stop(), 0)
    }
    // Swallow the click that closed the shape.
    setTimeout(() => { this.drawing = false }, 50)
  }

  flyTo(v: { center: [number, number]; zoom: number }) {
    this.map.flyTo({ ...v, pitch: Math.max(this.map.getPitch(), 30), duration: 1600, essential: true })
  }

  resize() {
    this.map.resize()
  }

  destroy() {
    this.map.remove()
  }
}

const EXEMPT_FALLBACK = '#d6d2c8'

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
