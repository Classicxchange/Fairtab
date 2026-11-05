/**
 * Regenerates the static copy of the landing page inside index.html, so visitors (and crawlers)
 * see the page instantly, before the app code loads. Run it after changing src/LandingPage.tsx:
 *   bun run scripts/gen-landing-static.tsx
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, writeFileSync } from 'node:fs'
import { LandingPage } from '../src/LandingPage'

const html = renderToStaticMarkup(<LandingPage onGetStarted={() => {}} dark={false} onToggleDark={() => {}} />)
const file = new URL('../index.html', import.meta.url).pathname
const src = readFileSync(file, 'utf8')
const start = '<!--landing:start-->'
const end = '<!--landing:end-->'
const block = `${start}\n        ${html}\n        ${end}`

let next: string
if (src.includes(start)) {
  next = src.replace(new RegExp(`${start}[\\s\\S]*?${end}`), () => block)
} else {
  // First run: replace everything inside the #static-landing wrapper
  const open = src.indexOf('<div id="static-landing"')
  const innerStart = src.indexOf('>', open) + 1
  // The wrapper closes just before the closing tags of #root; find it by matching our known tail
  const tail = src.indexOf('\n    </div>\n    <script type="module"')
  if (open < 0 || tail < 0) throw new Error('Could not locate the static landing block in index.html')
  const wrapperEnd = src.lastIndexOf('</div>', tail - 1)
  next = src.slice(0, innerStart) + `\n        ${block}\n      ` + src.slice(wrapperEnd)
}
writeFileSync(file, next)
console.log('Static landing updated:', html.length, 'bytes')
