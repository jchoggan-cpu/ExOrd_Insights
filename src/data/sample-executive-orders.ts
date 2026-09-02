import type { ExecutiveOrder } from "@/lib/types";

/**
 * SAMPLE / PLACEHOLDER DATA — not real executive orders.
 *
 * eoNumber values are prefixed "SAMPLE-" so they can never be confused with
 * a real Federal Register entry. This exists purely so the tracker UI has
 * something to render before two things happen:
 *   1. The real spreadsheet export is imported (see README "Importing your
 *      existing spreadsheet").
 *   2. The Federal Register ingestion job is wired up and running (Phase 2).
 *
 * Delete this file once real data is flowing through Supabase.
 */
export const SAMPLE_EXECUTIVE_ORDERS: ExecutiveOrder[] = [
  {
    id: "sample-1",
    eoNumber: "SAMPLE-EO-1",
    title: "Advancing Domestic Critical Minerals Production",
    federalRegisterUrl: "https://www.federalregister.gov/",
    dateSigned: "2025-02-11",
    datePublished: "2025-02-14",
    status: "active",
    agenciesImpacted: ["Department of the Interior", "Department of Energy", "EPA"],
    keyDates: [
      { label: "Agency implementation report due", date: "2025-05-11" },
      { label: "Permitting fast-track guidance due", date: "2025-08-11" },
    ],
    subjectArea: ["Energy Policy", "Domestic Manufacturing"],
    practiceAreas: ["Governmental", "Land Use"],
    industries: ["Energy and Infrastructure", "Environmental"],
    aiSummary:
      "Directs federal agencies to streamline permitting for domestic critical minerals mining and processing, and to prioritize related projects for federal financing programs.",
    deliverable: "Interior and DOE must jointly report a fast-track permitting framework within 180 days.",
    timelineNotes: "Implementation report due 90 days after signing; permitting guidance due 180 days after signing.",
    availableAnalysis: "Sample placeholder — replace with firm-authored analysis or generated summary.",
    legalChallenges: [
      {
        caseName: "Coalition for Environmental Review v. Department of the Interior",
        court: "U.S. District Court for the District of Columbia",
        status: "Pending",
        docketUrl: "https://www.courtlistener.com/",
        summary: "Challenges expedited permitting timelines as violating notice-and-comment requirements.",
      },
    ],
    newsMentions: [
      {
        title: "Mining industry welcomes streamlined federal permitting order",
        source: "Sample News Wire",
        url: "https://example.com/",
        date: "2025-02-12",
        snippet: "Industry groups praised the order while environmental groups signaled likely litigation.",
      },
    ],
    manuallyEditedFields: [],
    createdAt: "2025-02-12T00:00:00.000Z",
    updatedAt: "2025-02-12T00:00:00.000Z",
  },
  {
    id: "sample-2",
    eoNumber: "SAMPLE-EO-2",
    title: "Federal AI Procurement and Risk Management Standards",
    federalRegisterUrl: "https://www.federalregister.gov/",
    dateSigned: "2025-03-04",
    datePublished: "2025-03-07",
    status: "active",
    agenciesImpacted: ["OMB", "NIST", "GSA"],
    keyDates: [{ label: "Agency AI risk inventories due", date: "2025-06-04" }],
    subjectArea: ["Artificial Intelligence", "Federal Procurement"],
    practiceAreas: ["Governmental", "Privacy and Cybersecurity"],
    industries: ["AI, Robotics and Quantum", "Digital Infrastructure"],
    aiSummary:
      "Establishes minimum risk-management and testing standards agencies must require before procuring or deploying AI systems, building on NIST's AI Risk Management Framework.",
    deliverable: "Each covered agency must submit an AI system risk inventory within 90 days.",
    timelineNotes: "NIST guidance due 60 days after signing; agency compliance certifications due 120 days after.",
    availableAnalysis: "Sample placeholder — replace with firm-authored analysis or generated summary.",
    legalChallenges: [],
    newsMentions: [
      {
        title: "New order sets federal baseline for AI vendor risk assessments",
        source: "Sample Tech Report",
        url: "https://example.com/",
        date: "2025-03-05",
        snippet: "GovTech contractors are assessing compliance timelines ahead of the June deadline.",
      },
    ],
    manuallyEditedFields: [],
    createdAt: "2025-03-05T00:00:00.000Z",
    updatedAt: "2025-03-05T00:00:00.000Z",
  },
  {
    id: "sample-3",
    eoNumber: "SAMPLE-EO-3",
    title: "Strengthening Hospital Price Transparency Enforcement",
    federalRegisterUrl: "https://www.federalregister.gov/",
    dateSigned: "2025-04-22",
    datePublished: "2025-04-25",
    status: "amended",
    agenciesImpacted: ["Department of Health and Human Services", "CMS"],
    keyDates: [{ label: "CMS enforcement rule proposal due", date: "2025-07-22" }],
    subjectArea: ["Healthcare Pricing", "Consumer Protection"],
    practiceAreas: ["Governmental", "Litigation"],
    industries: ["Healthcare", "Insurance"],
    aiSummary:
      "Directs CMS to increase civil monetary penalties for hospitals that fail to comply with existing price transparency rules and to publish a public compliance dashboard.",
    deliverable: "CMS must propose an updated penalty structure within 90 days.",
    timelineNotes: "Amended May 30, 2025 to extend the CMS deadline by 30 days.",
    availableAnalysis: "Sample placeholder — replace with firm-authored analysis or generated summary.",
    legalChallenges: [
      {
        caseName: "American Hospital Coalition v. HHS",
        court: "U.S. District Court for the Northern District of Texas",
        status: "Preliminary injunction denied",
        docketUrl: "https://www.courtlistener.com/",
        summary: "Hospital trade group argued the penalty increase exceeds CMS's statutory authority; court declined to enjoin.",
      },
    ],
    newsMentions: [
      {
        title: "Hospitals face steeper fines under new price transparency order",
        source: "Sample Health Policy Daily",
        url: "https://example.com/",
        date: "2025-04-23",
        snippet: "Analysts expect a wave of compliance activity ahead of the CMS rulemaking deadline.",
      },
    ],
    manuallyEditedFields: ["deliverable"],
    createdAt: "2025-04-23T00:00:00.000Z",
    updatedAt: "2025-05-30T00:00:00.000Z",
  },
];
