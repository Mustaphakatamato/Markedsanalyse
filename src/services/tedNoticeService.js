// Fuld detalje for én TED-notice — udtrukket af den rigtige eForms-XML, ikke
// af de flade BT-felt-arrays fra /v3/notices/search.
//
// HVORFOR: For en rammeaftale/DPS med mange vindere (fx SKI's
// standardsoftware-rammeaftaler) leverer search-API'et winner-name og
// tender-value som PARALLELLE ARRAYS uden noget felt der pålideligt binder
// det ene navn til det rigtige beløb og den rigtige lot — verificeret ved
// direkte research: winner-name kan have 210 indgange, tender-lot-identifier
// 211, tender-identifier 209. At zippe dem sammen efter indeks ville kunne
// give en virksomhed et forkert beløb, i et værktøj der skal dokumentere en
// udbudsjournal. Det er værre end ikke at vise noget.
//
// Den fulde XML derimod har rammeaftalens rigtige struktur, joinet på ID'er:
//   efac:Organization       — ORG-id → virksomhedens navn
//   efac:TenderingParty     — TPA-id → hvilken(e) ORG-id der bød
//   efac:LotTender          — TEN-id, PayableAmount (DEN ENKELTE delkontrakts
//                              værdi), TenderLot, TenderingParty, og en
//                              TenderReference med ordregiverens egen
//                              beskrivelse af delkontrakten (typisk inkl.
//                              hvem den konkrete slutkunde er)
//   efac:SettledContract     — TEN-id → IssueDate (tildelingsdato)
//   cac:ProcurementProjectLot — Lot-id → titel, beskrivelse, CPV
//
// Verificeret på SKI's rammeaftale 294230-2024: Devoteam A/S (ORG-0020) er
// part i netop TPA-0016, som har to LotTender-indgange i LOT-0002 — hhv.
// 5.371.793 DKK ("Model Management tool - Ørsted Services A/S") og
// 5.349.411,84 DKK ("RPA udbud - Forsvarsministeriet") — et par promille af
// rammens loftværdi på 1.358.386.833 DKK, som ellers ville have stået som
// "værdi" i UI'et.
//
// Samme "global scan + join på lokalt tagnavn"-tilgang som
// regnskabService.js's XBRL-parsing — eForms-XML'en bruger UBL-navnerum og
// vilkårlige præfikser, men elementernes LOKALE navn (el.localName) er
// stabilt uanset præfiks.

import { getFromFunction } from "../lib/apiClient";
import { coreCompanyName, normalizeForMatch } from "./tedService";

function firstChildByLocalName(parent, name) {
  if (!parent) return null;
  return Array.from(parent.children).find((c) => c.localName === name) || null;
}

function childrenByLocalName(parent, name) {
  if (!parent) return [];
  return Array.from(parent.children).filter((c) => c.localName === name);
}

function allByLocalName(doc, name) {
  return Array.from(doc.getElementsByTagName("*")).filter((el) => el.localName === name);
}

// Samme som allByLocalName, men begrænset til ét elements undertræ — bruges
// hvor et felt sidder flere niveauer nede (fx AwardCriterionParameter, som
// ligger inde i tre lag ext:UBLExtensions/efext:EformsExtension omkring hvert
// SubordinateAwardingCriterion) og firstChildByLocalName derfor ikke rammer.
function descendantByLocalName(parent, name) {
  if (!parent) return null;
  return Array.from(parent.getElementsByTagName("*")).find((el) => el.localName === name) || null;
}

function text(el) {
  return el?.textContent?.trim() || null;
}

function parseAmount(raw) {
  if (raw == null) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

// CPV-koderne på ét cac:ProcurementProject-element — delt mellem
// notice'ens overordnede projekt og hvert lots eget (nedenunder), som hver
// har deres egen klassifikation.
function parseCpvCodes(proj) {
  if (!proj) return [];
  const classifications = [
    firstChildByLocalName(proj, "MainCommodityClassification"),
    ...childrenByLocalName(proj, "AdditionalCommodityClassification")
  ].filter(Boolean);
  return classifications.map((c) => text(firstChildByLocalName(c, "ItemClassificationCode"))).filter(Boolean);
}

// Notice'ens overordnede titel/beskrivelse/CPV — den øverste
// cac:ProcurementProject, ikke de lot-specifikke (dem har hver deres egen
// ProcurementProject inde i cac:ProcurementProjectLot).
function parseTopLevel(doc) {
  const proj = firstChildByLocalName(doc.documentElement, "ProcurementProject");
  return {
    title: text(firstChildByLocalName(proj, "Name")),
    description: text(firstChildByLocalName(proj, "Description")),
    cpvCodes: parseCpvCodes(proj)
  };
}

function parseLots(doc) {
  return allByLocalName(doc, "ProcurementProjectLot")
    .map((lotEl) => {
      const id = text(firstChildByLocalName(lotEl, "ID"));
      const proj = firstChildByLocalName(lotEl, "ProcurementProject");
      if (!id || !proj) return null;

      return {
        id,
        title: text(firstChildByLocalName(proj, "Name")),
        description: text(firstChildByLocalName(proj, "Description")),
        cpvCodes: parseCpvCodes(proj)
      };
    })
    .filter(Boolean);
}

// Ordregiverens navn: cac:ContractingParty peger IKKE direkte på et navn,
// kun på en efac:Organization-id via cac:Party > cac:PartyIdentification >
// cbc:ID — samme indirektion som vinderne. Der kan i sjældne tilfælde være
// flere ContractingParty-elementer (fælles udbud); vi tager den første der
// rent faktisk matcher en kendt organisation.
function parseBuyerName(doc, orgsById) {
  for (const contractingParty of allByLocalName(doc, "ContractingParty")) {
    const party = firstChildByLocalName(contractingParty, "Party");
    const id = text(firstChildByLocalName(firstChildByLocalName(party, "PartyIdentification"), "ID"));
    if (id && orgsById.has(id)) return orgsById.get(id);
  }
  return null;
}

// eForms' egen kodeliste for egnethedskrav (TendererRequirementTypeCode,
// listName="selection-criterion") starter alle koder med et fast præfiks pr.
// kategori — "slc-stand-*" er økonomisk/finansiel formåen, "slc-abil-*" er
// teknisk/faglig formåen, "slc-suit-*" er retten til at udøve erhvervet
// (autorisationer mv.). Verificeret på en rigtig, nylig dansk bekendtgørelse
// (Ørsted, 558609-2026): "slc-stand-other" og "slc-abil-ref-work".
//
// VIGTIGT: selve kravet (fx et minimumsomsætningskrav i kroner) står IKKE i
// et separat, struktureret talfelt — det ligger som fri tekst i
// Description-feltet, ofte som en hel juridisk afsnit. Vi udtrækker og
// kategoriserer derfor kravet, men forsøger BEVIDST IKKE at parse et konkret
// tal ud og lave et automatisk "opfylder/opfylder ikke"-tjek — det ville
// kunne give et falsk svar på et krav der reelt ikke står struktureret. Det
// er nøjagtig den slags falske positiv denne app konsekvent undgår andre
// steder (se sanktionstjekket). Kravteksten vises rå, sammen med
// virksomhedens egne rigtige tal ved siden af, så mennesket vurderer.
const CRITERION_CATEGORIES = [
  { prefix: "slc-stand", label: "Økonomisk og finansiel formåen" },
  { prefix: "slc-abil", label: "Teknisk og faglig formåen" },
  { prefix: "slc-suit", label: "Egnethed til at udøve erhvervet" }
];

function categorizeCriterion(typeCode) {
  return CRITERION_CATEGORIES.find((c) => typeCode?.startsWith(c.prefix))?.label || "Andet egnethedskrav";
}

function parseSelectionCriteria(doc) {
  return allByLocalName(doc, "SelectionCriteria")
    .map((el) => {
      const typeCode = text(firstChildByLocalName(el, "TendererRequirementTypeCode"));
      const description = text(firstChildByLocalName(el, "Description"));
      if (!description) return null;
      return { typeCode, category: categorizeCriterion(typeCode), description };
    })
    .filter(Boolean);
}

// Tildelingskriterier ("K-krav") — HELT adskilt XML-gren fra egnethedskrav
// ovenfor: cac:ProcurementProjectLot > cac:TenderingTerms > cac:AwardingTerms
// > cac:AwardingCriterion > cac:SubordinateAwardingCriterion (én pr. kriterie:
// pris/kvalitet/omkostning). Verificeret på samme Ørsted-notice
// (558609-2026): tre kriterier med AwardingCriterionTypeCode
// price/quality/quality og en vægt i procent hver (35/25/...).
//
// Vægten ligger tre lag nede i en eForms-extension
// (efac:AwardCriterionParameter > efbc:ParameterNumeric), styret af en
// separat kode (efbc:ParameterCode, listName="number-weight") der angiver
// HVILKEN slags tal der er tale om — kun "per-*"-koder er bekræftet at
// betyde procent (set: "per-exa"). Ukendte kode-præfikser viser vi rå,
// fremfor at gætte på enheden.
const AWARD_TYPE_LABELS = { price: "Pris", quality: "Kvalitet", cost: "Omkostning" };

function parseAwardWeight(criterionEl) {
  const param = descendantByLocalName(criterionEl, "AwardCriterionParameter");
  const code = text(firstChildByLocalName(param, "ParameterCode"));
  const value = parseAmount(text(firstChildByLocalName(param, "ParameterNumeric")));
  if (value == null) return null;
  return { value, unit: code?.startsWith("per") ? "%" : null, code };
}

function parseAwardCriteria(doc) {
  return allByLocalName(doc, "SubordinateAwardingCriterion")
    .map((el) => {
      const typeCode = text(firstChildByLocalName(el, "AwardingCriterionTypeCode"));
      const description = text(firstChildByLocalName(el, "Description"));
      if (!description) return null;
      return {
        typeCode,
        category: AWARD_TYPE_LABELS[typeCode] || "Andet tildelingskriterie",
        description,
        weight: parseAwardWeight(el)
      };
    })
    .filter(Boolean);
}

// Link(s) til det faktiske udbudsmateriale — TED rummer ALDRIG selve
// dokumenterne, kun en henvisning til ordregiverens eget udbudsportal (fx
// et ethics.dk/comdia/mercell/eget-portal-link). Verificeret på samme
// notice: ét cac:CallForTendersDocumentReference med en beskrivende
// cbc:ID ("All tender documents are available") og URL'en i
// cac:Attachment > cac:ExternalReference > cbc:URI. Mange af disse portaler
// kræver login for selve download — vi linker derfor videre, vi henter
// eller fortolker ikke dokumenterne selv.
function parseDocumentLinks(doc) {
  return allByLocalName(doc, "CallForTendersDocumentReference")
    .map((el) => {
      const uri = text(descendantByLocalName(el, "URI"));
      if (!uri) return null;
      return {
        label: text(firstChildByLocalName(el, "ID")) || "Udbudsmateriale",
        documentType: text(firstChildByLocalName(el, "DocumentType")),
        url: uri
      };
    })
    .filter(Boolean);
}

// ORG-id → organisationens navn (kun dem med både id og navn).
function parseOrganizations(doc) {
  const map = new Map();
  for (const org of allByLocalName(doc, "Organization")) {
    const company = firstChildByLocalName(org, "Company");
    const idEl = firstChildByLocalName(firstChildByLocalName(company, "PartyIdentification"), "ID");
    const nameEl = firstChildByLocalName(firstChildByLocalName(company, "PartyName"), "Name");
    const id = text(idEl);
    const name = text(nameEl);
    if (id && name) map.set(id, name);
  }
  return map;
}

// Find de ORG-id'er hvis navn matcher companyName — samme (konservative)
// matching som searchWonContractsByCompany(): eksakt normaliseret match
// først, ellers kernenavnet (uden selskabsform) som DELSTRENG. Aldrig løse
// enkeltord.
function matchOrganizationIds(orgsById, companyName) {
  const fullNeedle = normalizeForMatch(companyName);
  const core = coreCompanyName(companyName);
  const coreNeedle = core.length >= 3 ? normalizeForMatch(core) : null;

  const matched = new Set();
  for (const [id, name] of orgsById) {
    const normalized = normalizeForMatch(name);
    if (normalized === fullNeedle || (coreNeedle && normalized.includes(coreNeedle))) {
      matched.add(id);
    }
  }
  return matched;
}

// TPA-id'er hvor mindst én tilknyttet efac:Tenderer peger på et matchet ORG-id.
function matchTenderingPartyIds(doc, matchedOrgIds) {
  const matched = new Set();
  for (const tp of allByLocalName(doc, "TenderingParty")) {
    const id = text(firstChildByLocalName(tp, "ID"));
    if (!id) continue;
    const orgRefs = childrenByLocalName(tp, "Tenderer")
      .map((t) => text(firstChildByLocalName(t, "ID")))
      .filter(Boolean);
    if (orgRefs.some((ref) => matchedOrgIds.has(ref))) matched.add(id);
  }
  return matched;
}

// TEN-id → tildelingsdato, fra de FULDE efac:SettledContract-blokke (ikke de
// bare ID-referencer der også ligger inde i hver efac:LotResult).
function parseAwardDates(doc) {
  const map = new Map();
  for (const contract of allByLocalName(doc, "SettledContract")) {
    const date = text(firstChildByLocalName(contract, "IssueDate"));
    if (!date) continue;
    for (const lotTenderRef of childrenByLocalName(contract, "LotTender")) {
      const tenderId = text(firstChildByLocalName(lotTenderRef, "ID"));
      if (tenderId) map.set(tenderId, date);
    }
  }
  return map;
}

// De efac:LotTender-elementer der reelt beskriver en delkontrakt (har
// TenderingParty + PayableAmount) — IKKE de bare <ID>-referencer der også
// ligger inde i efac:LotResult, og som denne funktion derfor automatisk
// springer over (de mangler TenderingParty).
function matchingLotTenders(doc, matchedTpaIds) {
  const results = [];
  for (const lotTender of allByLocalName(doc, "LotTender")) {
    const tpId = text(firstChildByLocalName(firstChildByLocalName(lotTender, "TenderingParty"), "ID"));
    if (!tpId || !matchedTpaIds.has(tpId)) continue;

    const total = firstChildByLocalName(lotTender, "LegalMonetaryTotal");
    const payable = firstChildByLocalName(total, "PayableAmount");
    const lotRef = firstChildByLocalName(lotTender, "TenderLot");
    const reference = firstChildByLocalName(lotTender, "TenderReference");

    results.push({
      tenderId: text(firstChildByLocalName(lotTender, "ID")),
      lotId: text(firstChildByLocalName(lotRef, "ID")),
      value: parseAmount(text(payable)),
      currency: payable?.getAttribute("currencyID") || null,
      description: text(firstChildByLocalName(reference, "ID"))
    });
  }
  return results;
}

async function fetchNoticeXml(publicationNumber) {
  const response = await getFromFunction(`/ted-notice/${encodeURIComponent(publicationNumber)}`);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Kunne ikke hente TED-notice (HTTP ${response.status})`);
  }
  return response.text();
}

/**
 * Hent og udtræk fuld detalje for én TED-notice: notice'ens egen titel og
 * beskrivelse, alle lots (titel/beskrivelse/CPV), og — hvis companyName er
 * angivet og notice'en har flere vindere — DENNE virksomheds egne
 * delkontrakter med rigtig værdi, lot og beskrivelse hver især.
 *
 * @param {{ publicationNumber: string }} notice
 * @param {string} [companyName]
 * @returns {Promise<{
 *   title: string|null,
 *   description: string|null,
 *   lots: Array<{ id: string, title: string|null, description: string|null, cpvCodes: string[] }>,
 *   companyAwards: Array<{ tenderId: string|null, lotId: string|null, lotTitle: string|null, value: number|null, currency: string|null, description: string|null, awardDate: string|null }>,
 *   companyAwardsTotal: number
 * } | null>}
 */
export async function getNoticeDetail(notice, companyName) {
  if (!notice?.publicationNumber) return null;

  const xmlText = await fetchNoticeXml(notice.publicationNumber);
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Kunne ikke fortolke TED-notice'ens XML.");
  }

  const top = parseTopLevel(doc);
  const lots = parseLots(doc);

  let companyAwards = [];
  if (companyName?.trim()) {
    const orgsById = parseOrganizations(doc);
    const matchedOrgIds = matchOrganizationIds(orgsById, companyName);

    if (matchedOrgIds.size) {
      const matchedTpaIds = matchTenderingPartyIds(doc, matchedOrgIds);
      const awardDates = parseAwardDates(doc);

      companyAwards = matchingLotTenders(doc, matchedTpaIds).map((award) => ({
        ...award,
        lotTitle: lots.find((lot) => lot.id === award.lotId)?.title || null,
        awardDate: award.tenderId ? awardDates.get(award.tenderId) || null : null
      }));
    }
  }

  const companyAwardsTotal = companyAwards.reduce((sum, a) => sum + (a.value || 0), 0);

  return { title: top.title, description: top.description, lots, companyAwards, companyAwardsTotal };
}

/**
 * Hent og udtræk kravene i en AKTIV udbudsbekendtgørelse (ikke en
 * tildeling) — bruges af tilbudsgiver-flowet til at vise ordregiver,
 * CPV-koder, lots og egnethedskrav uden at skulle åbne selve
 * bekendtgørelsen. Virker på samme `ted-notice`-proxy som getNoticeDetail(),
 * der er en generisk XML-proxy uafhængig af notice-type.
 *
 * `criteria[].description` er ordregiverens EGEN tekst, ukommenteret — der
 * findes ikke noget struktureret talfelt at læse et minimumskrav ud af (se
 * kommentaren ved parseSelectionCriteria ovenfor), så denne funktion laver
 * IKKE en vurdering af om en given virksomhed opfylder kravet. Det er op til
 * UI'et at stille kravteksten op ved siden af virksomhedens egne tal.
 *
 * @param {string} publicationNumber
 * @returns {Promise<{
 *   title: string|null,
 *   description: string|null,
 *   buyerName: string|null,
 *   cpvCodes: string[],
 *   lots: Array<{ id: string, title: string|null, description: string|null, cpvCodes: string[] }>,
 *   criteria: Array<{ typeCode: string|null, category: string, description: string }>,
 *   awardCriteria: Array<{ typeCode: string|null, category: string, description: string, weight: { value: number, unit: string|null, code: string|null }|null }>,
 *   documentLinks: Array<{ label: string, documentType: string|null, url: string }>
 * } | null>}
 */
export async function getTenderRequirements(publicationNumber) {
  if (!publicationNumber) return null;

  const xmlText = await fetchNoticeXml(publicationNumber);
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Kunne ikke fortolke TED-notice'ens XML.");
  }

  const top = parseTopLevel(doc);
  const lots = parseLots(doc);
  const orgsById = parseOrganizations(doc);
  const buyerName = parseBuyerName(doc, orgsById);
  const criteria = parseSelectionCriteria(doc);
  const awardCriteria = parseAwardCriteria(doc);
  const documentLinks = parseDocumentLinks(doc);

  return {
    title: top.title,
    description: top.description,
    buyerName,
    cpvCodes: top.cpvCodes,
    lots,
    criteria,
    awardCriteria,
    documentLinks
  };
}
