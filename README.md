# PaohupByPaoZa

แดชบอร์ดพร็อกซีโมเดลในเครื่อง สไตล์แอปเปิล รองรับภาษาไทย  
ใช้ได้กับ Codex, Claude Code, Claude Desktop และ Grok Build เหมือนเดิม

## Brain Universe + WebMCP

เปิด http://127.0.0.1:10100/#seo สำหรับ Pao SEO Agent OS (Phase 18):
จัดการโปรเจกต์ SEO, รันการวิเคราะห์ baseline และกล่องรับคำแนะนำ
เชื่อมต่อ OpenSEO ภายนอกผ่าน MCP ด้วย env OPENSEO_ENABLED / OPENSEO_MODE /
OPENSEO_MCP_URL / OPENSEO_API_KEY ค่าเริ่มต้นใช้ MockSeoProvider
(ไม่มีต้นทุน, ติดป้าย provenance=mock) OpenSEO เป็น external provider —
PaohupByPaoZa คุม orchestration, policy, approval และ dashboard
ดู docs/PHASE_18_PAO_SEO_AGENT_OS.md

Phase 18.1 — Pao GEO Intelligence Engine (ต่อยอดในหน้า #seo เดิม):
ตรวจความพร้อม AI Search — robots.txt ของ AI crawler, llms.txt,
JSON-LD schema และ evidence verification แบบตรวจของจริงจากเว็บตรง
(ป้องกัน SSRF, ห้ามเดาถ้าตรวจไม่ได้) รันผ่าน
`POST /api/agent-os/seo/geo/projects/<id>/audit`
ดู docs/PHASE_18_1_PAO_GEO_INTELLIGENCE_ENGINE.md

ใช้แบบ headless ได้ด้วย `ocx seo health`, `ocx seo projects`,
`ocx seo analyze <projectId>`, `ocx seo geo-audit <projectId>`,
`ocx seo council <projectId>` และ `ocx seo report <projectId>`
ทุกคำสั่งเป็น read/analyze/review/plan เท่านั้น ไม่มี deploy เว็บอัตโนมัติ

เปิด http://127.0.0.1:10100/#brain เพื่อดู projects, tasks, agents, skills,
memory, policies, approvals, Atlas/Universe, WebMCP Tool Inspector และ Agent
Activity

เปิด http://127.0.0.1:10100/#demo สำหรับ Smart Factory challenge scenario

WebMCP ใช้ document.modelContext เมื่อ browser รองรับ และซ่อน tools อย่าง
ปลอดภัยเมื่อ API ยังไม่พร้อม Human UI กับ agent tools ใช้ Agent OS API,
policy และ approval gateway ชุดเดียวกัน ดูรายละเอียดที่
docs/PHASE-15-WEBMCP.md และ docs/WEBMCP-TOOLS.md

โปรเจคนี้อยู่ที่:

`C:\Users\AD PAO\Desktop\paohupbypaoZAZAZA55555`

ฐานมาจาก OpenCodex 2.26.0 + อัปเดตจากสาขา `dev` หลังนั้น เป็น PaohupByPaoZa **2.62.0** ฟังก์ชันเดิมครบ  
ตั้งค่าเดิมยังอยู่ที่ `~/.opencodex` ดังนั้นผู้ให้บริการ / บัญชี / โมเดลเดิมใช้ต่อได้ทันที

## เปิดใช้งาน

ปิด `ocx` ตัวเดิมก่อนถ้าพอร์ต 10100 ถูกใช้อยู่ แล้วรัน:

```powershell
cd "C:\Users\AD PAO\Desktop\paohupbypaoZAZAZA55555"
bun install
cd gui; bun install; bun run build; cd ..
bun run src/cli/index.ts start --port 10100
```

หรือดับเบิลคลิก `start.cmd`

ภาษาเริ่มต้นคือ **ไทย** (เปลี่ยนได้ที่ตัวเลือกภาษาด้านซ้าย)

ถ้าต้องการให้รันพื้นหลังอัตโนมัติแบบเดิม เปิด PowerShell แบบผู้ดูแลแล้วรัน:

```powershell
cd "C:\Users\AD PAO\Desktop\paohupbypaoZAZAZA55555"
bun run src/cli/index.ts service
```

แล้วเปิด http://localhost:10100/#dashboard

คำสั่งที่ใช้ได้ (ชี้มาที่โปรเจคนี้แล้ว):

- `paohup start`
- `paohupbypaoza start`
- `ocx start` (ชื่อเดิม ยังใช้ได้)

เช็กสถานะ: `paohup status`

## สิ่งที่เปลี่ยน

- ชื่อผลิตภัณฑ์: **PaohupByPaoZa**
- UI สไตล์แอปเปิล (สีฟ้าระบบ, ฟอนต์ระบบ, กระจกฝ้า, มุมโค้ง)
- เพิ่มภาษาไทยในตัวเลือกภาษา (ตรวจจับ `th` อัตโนมัติ)
- พอร์ต / API / header / config เดิมยังเหมือนเดิม เพื่อไม่ให้ client ที่ผูกไว้พัง

## พูลบัญชี

พูลบัญชี ChatGPT / Codex ใช้เพื่อ routing และความทนทานเท่านั้น ไม่ได้รับประกันว่าจะเลี่ยง rate limit การระงับ หรือมาตรการอื่นของ provider ห้ามใช้เพื่อเลี่ยงข้อจำกัดหรือแชร์บัญชีกัน คนใช้มีหน้าที่ปฏิบัติตาม terms ปัจจุบันของแต่ละเจ้า

## English

PaohupByPaoZa is a local LLM provider proxy dashboard. Same engine as OpenCodex 2.26.0, new name, Apple-style UI, Thai language. Existing `~/.opencodex` config is reused on purpose. This overlay tracks OpenCodex `dev` as **2.62.0**.

Account pooling is for routing and operational resilience only; it does not guarantee protection from provider rate limits, enforcement, suspension, or other account actions. PaohupByPaoZa does not endorse using additional accounts to circumvent provider limits or sharing account credentials between people. You are responsible for complying with each provider's current terms.
