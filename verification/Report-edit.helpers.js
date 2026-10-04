// verification/report-edit.helpers.js
// مواصفات الحقول القابلة للتعديل من طرف الأدمن + التحقق + المقارنة.
// دوال نقية: لا اتصال بقاعدة البيانات هنا، ولا تُبنى أي أسماء أعمدة من مدخلات المستخدم
// (أسماء الجداول والأعمدة تأتي حصراً من هذه القائمة البيضاء).

const STATUS = ['Conforme', 'Défaut'];
const TEXT_MAX = 20000;

const f = {
  enum: (values) => ({ type: 'enum', values }),
  str: (max = 255) => ({ type: 'string', max }),
  text: () => ({ type: 'string', max: TEXT_MAX }),
  bool: () => ({ type: 'bool' }),
  int: (min, max) => ({ type: 'int', min, max })
};

const TIRE_POSITIONS = ['avg', 'avd', 'arg', 'ard'];
const STRUCT_ITEMS = ['longerons', 'traverses', 'passage_roues', 'fond_coffre', 'chassis', 'optique', 'vitre'];

const suspensionFields = {};
TIRE_POSITIONS.forEach((p) => {
  suspensionFields[`usure_pneu_${p}`] = f.enum(STATUS);
  suspensionFields[`obs_pneu_${p}`] = f.str(255);
  suspensionFields[`jante_${p}`] = f.enum(STATUS);
  suspensionFields[`jante_${p}_obs`] = f.str(255);
});
suspensionFields.corrosion_soubassement = f.bool();
suspensionFields.traces_choc = f.bool();
suspensionFields.notes = f.text();

const toleFields = {};
STRUCT_ITEMS.forEach((k) => {
  toleFields[`${k}_status`] = f.enum(STATUS);
  toleFields[`${k}_obs`] = f.str(255);
});
toleFields.conclusion_structure = f.enum([
  'Aucun accident détecté',
  'Accident léger',
  'Accident réparé',
  'Véhicule accidenté structurellement'
]);
toleFields.notes = f.text();
// ملاحظة: elements_ext_json (رسومات الصور) غير قابلة للتعديل هنا عمداً، ولا technician_id أيضاً.

const SPECS = {
  scanner: {
    table: 'inspection_scanner',
    fields: {
      calculateur_status: f.enum(['OK', 'DEFAUT']),
      voyants_allumes: f.str(255),
      dtc_codes: f.text(),
      notes: f.text()
    }
  },
  moteur: {
    table: 'inspection_moteur',
    fields: {
      niveau_huile: f.enum(['OK', 'BAS', 'ANORMAL']),
      fuite_huile: f.bool(),
      fuite_liquide_refroidissement: f.bool(),
      bruit_moteur: f.bool(),
      fumee_echappement: f.enum(['AUCUNE', 'BLANCHE', 'NOIRE', 'BLEUE']),
      notes: f.text()
    }
  },
  suspension: { table: 'inspection_suspension', fields: suspensionFields },
  tole: { table: 'inspection_tole', fields: toleFields },
  kilometrage: {
    table: 'inspection_kilometrage',
    fields: {
      kilometrage_affiche: f.int(0, 9999999),
      conformite: f.enum(['REAL', 'SUSPECT', 'UNCERTAIN']),
      notes: f.text()
    },
    requiredOnCreate: ['kilometrage_affiche']   // عمود NOT NULL بلا قيمة افتراضية
  },
  general: {
    table: 'inspection_general_observations',
    fields: {
      nombre_cles: f.int(0, 20),
      rapport_mecanique: f.text(),
      equipements_secour: f.str(255)
    }
  }
};

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// يعيد { value } أو { error }
function normalizeValue(spec, raw) {
  switch (spec.type) {
    case 'enum':
      return spec.values.includes(raw)
        ? { value: raw }
        : { error: `valeur non autorisée (attendu : ${spec.values.join(' / ')})` };

    case 'string': {
      if (raw === null || raw === undefined) return { value: null };
      if (typeof raw !== 'string' && typeof raw !== 'number') return { error: 'texte attendu' };
      const s = String(raw).trim();
      if (s === '') return { value: null };
      if (s.length > spec.max) return { error: `trop long (maximum ${spec.max} caractères)` };
      return { value: s };
    }

    case 'bool':
      if (raw === true || raw === 1 || raw === '1' || raw === 'true') return { value: 1 };
      if (raw === false || raw === 0 || raw === '0' || raw === 'false') return { value: 0 };
      return { error: 'valeur booléenne attendue' };

    case 'int': {
      if (raw === '' || raw === null || raw === undefined || typeof raw === 'boolean') return { error: 'nombre entier requis' };
      const n = Number(raw);
      if (!Number.isInteger(n)) return { error: 'nombre entier requis' };
      if (n < spec.min || n > spec.max) return { error: `doit être compris entre ${spec.min} et ${spec.max}` };
      return { value: n };
    }

    default:
      return { error: 'type de champ inconnu' };
  }
}

// يتحقق من حمولة { sectionKey: { field: value } } ويرفض أي قسم أو حقل غير معروف
function validateSections(sectionsInput) {
  const errors = [];
  const clean = {};

  if (!sectionsInput || typeof sectionsInput !== 'object' || Array.isArray(sectionsInput)) {
    return { errors: ['Format invalide : l\'objet "sections" est attendu.'], clean };
  }

  for (const [sectionKey, fields] of Object.entries(sectionsInput)) {
    if (!has(SPECS, sectionKey)) { errors.push(`Section inconnue : ${sectionKey}`); continue; }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) { errors.push(`${sectionKey} : objet attendu`); continue; }

    const spec = SPECS[sectionKey];
    for (const [field, raw] of Object.entries(fields)) {
      if (!has(spec.fields, field)) { errors.push(`${sectionKey}.${field} : champ non modifiable`); continue; }
      const r = normalizeValue(spec.fields[field], raw);
      if (r.error) errors.push(`${sectionKey}.${field} : ${r.error}`);
      else {
        if (!clean[sectionKey]) clean[sectionKey] = {};
        clean[sectionKey][field] = r.value;
      }
    }
  }
  return { errors, clean };
}

function sameValue(fieldSpec, oldVal, newVal) {
  if (fieldSpec.type === 'bool' || fieldSpec.type === 'int') return Number(oldVal) === Number(newVal);
  return (oldVal ?? '') === (newVal ?? '');
}

// الفروقات الفعلية فقط: { field: [old, new] }
function diffSection(existingRow, newValues, specFields) {
  const diff = {};
  for (const [field, newVal] of Object.entries(newValues)) {
    const oldVal = existingRow[field];
    if (!sameValue(specFields[field], oldVal, newVal)) diff[field] = [oldVal ?? null, newVal];
  }
  return diff;
}

// تقصير القيم الطويلة قبل تخزينها بسجل التعديلات
function truncateChangesForLog(changes, max = 500) {
  const cut = (v) => (typeof v === 'string' && v.length > max ? v.slice(0, max) + '…' : v);
  const out = {};
  for (const [section, value] of Object.entries(changes)) {
    if (section === '_created') { out[section] = value; continue; }
    out[section] = {};
    for (const [field, pair] of Object.entries(value)) out[section][field] = [cut(pair[0]), cut(pair[1])];
  }
  return out;
}

module.exports = { SPECS, STATUS, normalizeValue, validateSections, sameValue, diffSection, truncateChangesForLog };