import { useId, useMemo, useRef, useState } from 'react'
import type { Meta } from '../data/types'
import {
  addressesLoaded, geocodeDigits, loadAddresses, photonSearch, searchAddresses, searchGeocodes,
  type PhotonResult, type SearchResult,
} from './addressIndex'

export type SearchPick =
  | { kind: 'parcel'; pid: string; lon: number; lat: number; unit?: string }
  | { kind: 'point'; lon: number; lat: number; label: string }

type Option =
  | { type: 'local'; r: SearchResult }
  | { type: 'photon'; r: PhotonResult }
  | { type: 'ask-photon' }

export default function SearchBox({ meta, onPick }: { meta: Meta; onPick: (p: SearchPick) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(addressesLoaded())
  const [loadErr, setLoadErr] = useState(false)
  const [active, setActive] = useState(-1)
  const [photon, setPhoton] = useState<{ q: string; results: PhotonResult[] | null; error?: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const onFocus = () => {
    setOpen(true)
    if (!ready) loadAddresses(meta).then(() => setReady(true), () => setLoadErr(true))
  }

  const local = useMemo<SearchResult[]>(() => {
    if (!ready || !q.trim()) return []
    const digits = geocodeDigits(q)
    return digits ? searchGeocodes(digits, meta) : searchAddresses(q, meta)
  }, [q, ready, meta])

  const trimmed = q.trim()
  const photonForQ = photon && photon.q === trimmed ? photon : null
  const options: Option[] = [
    ...local.map((r) => ({ type: 'local' as const, r })),
    ...(photonForQ?.results ?? []).map((r) => ({ type: 'photon' as const, r })),
    ...(trimmed.length >= 3 && !photonForQ && !geocodeDigits(q) ? [{ type: 'ask-photon' as const }] : []),
  ]

  const askPhoton = () => {
    const query = trimmed
    if (query.length < 3) return
    setPhoton({ q: query, results: null })
    photonSearch(query, meta).then(
      (results) => setPhoton((p) => (p && p.q === query ? { q: query, results } : p)),
      (e: Error) => setPhoton((p) => (p && p.q === query ? { q: query, results: [], error: e.message } : p)),
    )
  }

  const choose = (o: Option) => {
    if (o.type === 'ask-photon') {
      askPhoton()
      return
    }
    if (o.type === 'local') onPick({ kind: 'parcel', pid: o.r.pid, lon: o.r.lon, lat: o.r.lat, unit: o.r.unit })
    else onPick({ kind: 'point', lon: o.r.lon, lat: o.r.lat, label: o.r.label })
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(options.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(-1, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (active >= 0 && options[active]) choose(options[active])
      else if (local.length) choose({ type: 'local', r: local[0] })
      else if (photonForQ?.results?.length) choose({ type: 'photon', r: photonForQ.results[0] })
      else if (!photonForQ) askPhoton()
    } else if (e.key === 'Escape') {
      if (open) setOpen(false)
      else setQ('')
    }
  }

  const optId = (i: number) => `${listId}-opt-${i}`
  const showList = open && trimmed.length > 0

  return (
    <div className="search">
      <svg className="search-icon" viewBox="0 0 16 16" aria-hidden>
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search address or parcel ID"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? optId(active) : undefined}
        placeholder="Search address or parcel ID"
        autoComplete="off"
        spellCheck={false}
        value={q}
        onChange={(e) => { setQ(e.target.value); setActive(-1); setOpen(true) }}
        onFocus={onFocus}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <div className="search-pop">
          <ul id={listId} role="listbox" aria-label="Search results">
            {options.map((o, i) => (
              <li
                key={i}
                id={optId(i)}
                role="option"
                aria-selected={i === active}
                className={`search-opt ${i === active ? 'active' : ''} ${o.type}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
              >
                {o.type === 'local' && (
                  <>
                    <span className="so-main">{o.r.label}</span>
                    <span className="so-sub">{o.r.sub}</span>
                  </>
                )}
                {o.type === 'photon' && (
                  <>
                    <span className="so-main">{o.r.label}</span>
                    <span className="so-sub">{o.r.sub || 'Map location'}</span>
                  </>
                )}
                {o.type === 'ask-photon' && <span className="so-main so-ask">Search the map for "{trimmed}"</span>}
              </li>
            ))}
          </ul>
          {!ready && !loadErr && <div className="search-note">Loading addresses…</div>}
          {loadErr && <div className="search-note">Couldn't load the address list.</div>}
          {ready && !local.length && !photonForQ && <div className="search-note">No matching address or parcel ID.</div>}
          {photonForQ && photonForQ.results == null && <div className="search-note">Searching the map…</div>}
          {photonForQ?.results && !photonForQ.results.length && (
            <div className="search-note">{photonForQ.error ? 'Map search is unavailable right now.' : 'No map results.'}</div>
          )}
          {photonForQ && <div className="search-attr">Search fallback: Photon by Komoot, © OpenStreetMap contributors</div>}
        </div>
      )}
    </div>
  )
}
