import loadJSZip from '../../tools/load-jszip.mjs';
import { mmToTwips } from '../../assets/js/units.js';

export const JSZip = loadJSZip();
export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function run(text, { rPr = '', pageBreak = false } = {}) {
  const properties = rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
  return `<w:r>${properties}<w:t xml:space="preserve">${escapeXml(text)}</w:t>`
    + `${pageBreak ? '<w:br w:type="page"/>' : ''}</w:r>`;
}

export function p(text, { pPr = '', rPr = '', style = null, pageBreak = false, rawRuns = null } = {}) {
  const pStyle = style ? `<w:pStyle w:val="${escapeXml(style)}"/>` : '';
  const properties = pStyle || pPr ? `<w:pPr>${pStyle}${pPr}</w:pPr>` : '';
  const runs = rawRuns !== null ? rawRuns : run(text, { rPr, pageBreak });
  return `<w:p>${properties}${runs}</w:p>`;
}

export function documentXml(body, { sectPr = '' } = {}) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<w:document xmlns:w="${W_NS}"><w:body>${body}${sectPr}</w:body></w:document>`;
}

export function sectPr({ left = 30, right = 15, top = 20, bottom = 20 } = {}) {
  return '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
    + `<w:pgMar w:top="${mmToTwips(top)}" w:right="${mmToTwips(right)}"`
    + ` w:bottom="${mmToTwips(bottom)}" w:left="${mmToTwips(left)}"/>`
    + '</w:sectPr>';
}

export function style({ id, type = 'paragraph', name = null, basedOn = null, isDefault = false, pPr = '', rPr = '' } = {}) {
  return `<w:style w:type="${type}" w:styleId="${escapeXml(id)}"`
    + `${isDefault ? ' w:default="1"' : ''}>`
    + `<w:name w:val="${escapeXml(name || id)}"/>`
    + `${basedOn ? `<w:basedOn w:val="${escapeXml(basedOn)}"/>` : ''}`
    + `${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}`
    + `${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}`
    + '</w:style>';
}

export function stylesXml({ docRPr = '', docPPr = '', styles = '' } = {}) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + `<w:styles xmlns:w="${W_NS}"><w:docDefaults>`
    + `<w:rPrDefault>${docRPr ? `<w:rPr>${docRPr}</w:rPr>` : '<w:rPr/>'}</w:rPrDefault>`
    + `<w:pPrDefault>${docPPr ? `<w:pPr>${docPPr}</w:pPr>` : '<w:pPr/>'}</w:pPrDefault>`
    + `</w:docDefaults>${styles}</w:styles>`;
}

export function themeXml({ major = 'Times New Roman', minor = 'Times New Roman', cyrillic = null } = {}) {
  const font = (scheme, face) => {
    const cyr = cyrillic || face;
    return `<a:${scheme}><a:latin typeface="${escapeXml(face)}"/>`
      + `<a:font script="Cyrl" typeface="${escapeXml(cyr)}"/></a:${scheme}>`;
  };
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Test">'
    + `<a:themeElements><a:fontScheme name="Test">${font('majorFont', major)}${font('minorFont', minor)}`
    + '</a:fontScheme></a:themeElements></a:theme>';
}

export function packageParts({ document, styles, theme = null }) {
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '</Types>';
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>';
  const parts = {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rootRels,
    'word/document.xml': document,
    'word/styles.xml': styles,
  };
  if (theme) parts['word/theme/theme1.xml'] = theme;
  return parts;
}

export async function buildDocx(parts, type = 'uint8array') {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(parts)) zip.file(path, content);
  return zip.generateAsync({ type, compression: 'DEFLATE' });
}

export async function makeDocxFile(document, styles, { theme = null, name = 'work.docx' } = {}) {
  const bytes = await buildDocx(packageParts({ document, styles, theme }));
  return new File([bytes], name, { type: DOCX_MIME });
}

/** Профиль ГОСТ, но с параметрами, удобными для точечных тестов. */
export function testProfile(overrides = {}) {
  return {
    id: 'test-profile',
    name: 'Тестовый профиль',
    version: 1,
    marginsMm: { left: 30, right: 15, top: 20, bottom: 20 },
    fontFamily: 'Times New Roman',
    minFontPt: 14,
    lineSpacing: 1.5,
    firstLineMm: 12.5,
    alignment: 'justify',
    ...overrides,
  };
}
