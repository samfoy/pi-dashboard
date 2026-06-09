/**
 * File routes — browse, read, write, versions, watching, styles
 */
import express, { Request, Response } from 'express'
import { readdirSync, statSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs'
import { readFile, writeFile, mkdir, open, stat } from 'fs/promises'
import { join, dirname, basename, extname } from 'path'
import os from 'os'
import { execFile } from 'child_process'
import type { RouteDeps } from './types.js'

const expandHome = (p: string | undefined): string | undefined => p && p.startsWith('~/') ? join(os.homedir(), p.slice(2)) : p

export function registerFileRoutes(deps: RouteDeps): void {
  const { app, versionStore, recentWrites, createVersion } = deps

  // Browse directory contents (for file tree picker)
  app.get('/api/browse', (req: Request, res: Response) => {
    const target = (req.query.path as string) || os.homedir()
    try {
      const showHidden = req.query.hidden === 'true'
      const showFiles = req.query.files === 'true'
      const entries = readdirSync(target, { withFileTypes: true })
        .filter(e => (showHidden || !e.name.startsWith('.')) && e.name !== 'node_modules')
        .map(e => {
          const full = join(target, e.name)
          let isDir = e.isDirectory()
          if (e.isSymbolicLink()) try { isDir = statSync(full).isDirectory() } catch {}
          return { name: e.name, path: full, isDir }
        })
        .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
        .filter(e => showFiles ? true : e.isDir)
      res.json({ path: target, parent: dirname(target), entries })
    } catch (e: any) {
      res.status(400).json({ error: e.message, path: target, parent: dirname(target), entries: [] })
    }
  })

  // Path completion — given a partial path, return matching entries
  app.get('/api/path-complete', (req: Request, res: Response) => {
    const input = (req.query.input as string) || ''
    try {
      let dir: string, prefix: string
      const expanded = input.startsWith('~') ? input.replace(/^~/, os.homedir()) : input
      if (expanded.endsWith('/')) {
        dir = expanded
        prefix = ''
      } else {
        dir = dirname(expanded)
        prefix = basename(expanded)
      }
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter(e => e.name.startsWith(prefix) && (prefix || !e.name.startsWith('.')))
        .slice(0, 30)
        .map(e => {
          const full = join(dir, e.name)
          let isDir = e.isDirectory()
          if (e.isSymbolicLink()) try { isDir = statSync(full).isDirectory() } catch {}
          return { name: e.name, path: full, isDir }
        })
        .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
      res.json({ dir, prefix, entries })
    } catch {
      res.json({ dir: '', prefix: '', entries: [] })
    }
  })

  // File read — supports ?tail=<bytes> to return only the last N bytes
  // (useful for huge append-only logs like sub-agent transcripts).
  app.get('/api/file-read', async (req: Request, res: Response) => {
    const filePath = expandHome(req.query.path as string)
    if (!filePath) return res.status(400).json({ error: 'path required' })
    const tail = req.query.tail ? parseInt(req.query.tail as string, 10) : 0
    try {
      if (tail > 0) {
        const st = await stat(filePath)
        const size = st.size
        if (size <= tail) {
          const content = await readFile(filePath, 'utf-8')
          res.set('X-File-Size', String(size))
          res.set('X-Tail-Truncated', '0')
          return res.type('text/plain').send(content)
        }
        const start = size - tail
        const fh = await open(filePath, 'r')
        try {
          const buf = Buffer.allocUnsafe(tail)
          await fh.read(buf, 0, tail, start)
          // Drop partial first line so JSONL parsers don't choke.
          let s = buf.toString('utf-8')
          const nl = s.indexOf('\n')
          if (nl >= 0) s = s.slice(nl + 1)
          res.set('X-File-Size', String(size))
          res.set('X-Tail-Truncated', '1')
          return res.type('text/plain').send(s)
        } finally {
          await fh.close()
        }
      }
      const content = await readFile(filePath, 'utf-8')
      res.type('text/plain').send(content)
    } catch (e: any) {
      res.status(e.code === 'ENOENT' ? 404 : 500).json({ error: e.message })
    }
  })

  // Save image
  app.post('/api/save-image', async (req: Request, res: Response) => {
    const { data, mimeType, path: rawPath } = req.body
    if (!data || !rawPath) return res.status(400).json({ error: 'data and path required' })
    const filePath = rawPath.startsWith('~') ? join(os.homedir(), rawPath.slice(1)) : rawPath.startsWith('/') ? rawPath : join(process.cwd(), rawPath)
    try {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, Buffer.from(data, 'base64'))
      res.json({ ok: true, path: filePath })
    } catch (e: any) {
      res.status(500).json({ error: e.message })
    }
  })

  // Upload dropped files
  app.post('/api/upload-files', async (req: Request, res: Response) => {
    const { files } = req.body as { files: { name: string; data: string }[] }
    if (!files?.length) return res.status(400).json({ error: 'files required' })
    const uploadDir = join(os.tmpdir(), 'pi-dashboard-uploads')
    await mkdir(uploadDir, { recursive: true })
    const paths: string[] = []
    for (const f of files) {
      const safeName = basename(f.name)
      const name = `${Date.now()}-${safeName}`
      const filePath = join(uploadDir, name)
      await writeFile(filePath, Buffer.from(f.data, 'base64'))
      // For PDFs: extract text and produce a readable ref file that includes the
      // original PDF path (so pi can copy it to vault) + the extracted text content.
      if (extname(safeName).toLowerCase() === '.pdf') {
        const txtPath = filePath + '.extracted.txt'
        const refPath = filePath + '.ref.txt'
        try {
          await new Promise<void>((resolve, reject) => {
            execFile('pdf2txt.py', ['-o', txtPath, filePath], { timeout: 15000 }, (err) => {
              if (err) reject(err)
              else resolve()
            })
          })
          const extracted = await readFile(txtPath, 'utf-8')
          const ref = `Attached file: ${safeName}\nFile path (use this to save or copy the PDF): ${filePath}\n\n--- Extracted text ---\n${extracted}`
          await writeFile(refPath, ref, 'utf-8')
          paths.push(refPath)
        } catch {
          // pdf2txt failed — write a ref file with just the path so pi still knows where it is
          const ref = `Attached file: ${safeName}\nFile path: ${filePath}\n\n(Text extraction failed — use the fetch_content tool or read the file path above to access this PDF.)`
          await writeFile(refPath, ref, 'utf-8').catch(() => {})
          paths.push(refPath)
        }
      } else {
        paths.push(filePath)
      }
    }
    res.json({ ok: true, paths })
  })

  // File write
  app.post('/api/file-write', async (req: Request, res: Response) => {
    const filePath = expandHome(req.body.path)
    const content = req.body.content
    if (!filePath || content == null) return res.status(400).json({ error: 'path and content required' })
    try {
      await mkdir(dirname(filePath), { recursive: true })
      recentWrites.set(filePath, Date.now())
      await writeFile(filePath, content, 'utf-8')
      const version = createVersion(filePath, content)
      res.json({ ok: true, version })
    } catch (e: any) {
      res.status(500).json({ error: e.message })
    }
  })

  // File versions
  app.get('/api/file-versions', (req: Request, res: Response) => {
    const filePath = expandHome(req.query.path as string)
    if (!filePath) return res.status(400).json({ error: 'path required' })
    const versions = (versionStore.get(filePath) || []).map(v => ({
      version: v.version, timestamp: v.timestamp, size: v.content.length
    }))
    res.json({ versions })
  })

  app.get('/api/file-version', (req: Request, res: Response) => {
    const filePath = expandHome(req.query.path as string)
    const ver = parseInt(req.query.version as string)
    if (!filePath || isNaN(ver)) return res.status(400).json({ error: 'path and version required' })
    const versions = versionStore.get(filePath)
    const entry = versions?.find(v => v.version === ver)
    if (!entry) return res.status(404).json({ error: 'version not found' })
    res.type('text/plain').send(entry.content)
  })

  // Comment Sidecar Routes
  app.get('/api/file-comments', async (req: Request, res: Response) => {
    const filePath = expandHome(req.query.path as string)
    if (!filePath) return res.status(400).json({ error: 'path required' })
    const dir = dirname(filePath)
    const sidecar = join(dir, '.' + basename(filePath) + '.comments.json')
    try {
      const raw = await readFile(sidecar, 'utf-8')
      res.json({ comments: JSON.parse(raw) })
    } catch (e: any) {
      if (e.code === 'ENOENT') return res.json({ comments: [] })
      res.status(500).json({ error: e.message })
    }
  })

  app.post('/api/file-comments', async (req: Request, res: Response) => {
    const filePath = expandHome(req.body.path)
    const comments = req.body.comments
    if (!filePath || !Array.isArray(comments)) return res.status(400).json({ error: 'path and comments array required' })
    const dir = dirname(filePath)
    const sidecar = join(dir, '.' + basename(filePath) + '.comments.json')
    try {
      await writeFile(sidecar, JSON.stringify(comments, null, 2), 'utf-8')
      res.json({ ok: true })
    } catch (e: any) {
      res.status(500).json({ error: e.message })
    }
  })

  // Serve local files (images from tool results, etc.)
  app.get('/api/local-file', (req: Request, res: Response) => {
    const filePath = req.query.path as string
    if (!filePath || typeof filePath !== 'string') return res.status(400).json({ error: 'path required' })
    let resolved = filePath.startsWith('~') ? join(os.homedir(), filePath.slice(1)) : filePath
    if (!resolved.startsWith('/')) resolved = join(process.cwd(), resolved)
    res.sendFile(resolved, { root: '/' }, (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'not found' }) })
  })

  app.get('/api/local-file/download', (req: Request, res: Response) => {
    const filePath = req.query.path as string
    if (!filePath || typeof filePath !== 'string') return res.status(400).json({ error: 'path required' })
    let resolved = filePath.startsWith('~') ? join(os.homedir(), filePath.slice(1)) : filePath
    if (!resolved.startsWith('/')) resolved = join(process.cwd(), resolved)
    const filename = resolved.split('/').pop() || 'file'
    res.download(resolved, filename, (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'not found' }) })
  })

  // Custom Styles
  const STYLES_DIR = join(os.homedir(), '.pi', 'dashboard', 'styles')
  mkdirSync(STYLES_DIR, { recursive: true })
  const ACTIVE_STYLE_FILE = join(STYLES_DIR, '.active')

  app.get('/api/styles', (_req: Request, res: Response) => {
    try {
      const files = readdirSync(STYLES_DIR).filter(f => f.endsWith('.css')).map(f => f.replace(/\.css$/, ''))
      let active = ''
      try { active = readFileSync(ACTIVE_STYLE_FILE, 'utf-8').trim() } catch {}
      res.json({ styles: files, active })
    } catch { res.json({ styles: [], active: '' }) }
  })

  app.get('/api/styles/:name', (req: Request, res: Response) => {
    const name = req.params.name as string
    if (!name || /[/\\]/.test(name)) return res.status(400).json({ error: 'invalid name' })
    try {
      const css = readFileSync(join(STYLES_DIR, name + '.css'), 'utf-8')
      res.json({ name, css })
    } catch { res.status(404).json({ error: 'not found' }) }
  })

  app.put('/api/styles/:name', express.json(), async (req: Request, res: Response) => {
    const name = req.params.name as string
    if (!name || /[/\\]/.test(name) || name.startsWith('.')) return res.status(400).json({ error: 'invalid name' })
    const css = req.body?.css
    if (typeof css !== 'string') return res.status(400).json({ error: 'css required' })
    await writeFile(join(STYLES_DIR, name + '.css'), css, 'utf-8')
    res.json({ ok: true })
  })

  app.delete('/api/styles/:name', (req: Request, res: Response) => {
    const name = req.params.name as string
    if (!name || /[/\\]/.test(name)) return res.status(400).json({ error: 'invalid name' })
    try { unlinkSync(join(STYLES_DIR, name + '.css')) } catch {}
    try { if (readFileSync(ACTIVE_STYLE_FILE, 'utf-8').trim() === name) writeFileSync(ACTIVE_STYLE_FILE, '', 'utf-8') } catch {}
    res.json({ ok: true })
  })

  app.put('/api/styles-active', express.json(), async (req: Request, res: Response) => {
    const name = req.body?.name ?? ''
    await writeFile(ACTIVE_STYLE_FILE, name, 'utf-8')
    res.json({ ok: true })
  })
}
