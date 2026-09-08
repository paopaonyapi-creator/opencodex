# Phase 20.11 — Pao-hubPro Browser
## Agent-Native Browser Runtime for Pao-hubPro

> **Project:** Pao-hubPro  
> **Phase:** 20.11  
> **Component Name:** Pao-hubPro Browser  
> **Base Reference:** `paddman/CYRVOR-CherryBrowser`  
> **Primary Goal:** เปลี่ยน Desktop Browser ที่สร้างด้วย Electron/Chromium ให้เป็น Browser Runtime ที่ Pao-hubPro, ChatGPT, Codex, Local AI และ Agent อื่น ๆ สามารถควบคุมผ่าน MCP ได้อย่างปลอดภัย  
> **Status:** Planned / Ready for Implementation

---

# 1. ภาพรวม Phase

Phase 20.11 มีเป้าหมายสร้าง **Pao-hubPro Browser** ซึ่งเป็น Browser Runtime แบบ Agent-Native สำหรับระบบ Pao-hubPro

แนวคิดหลักคือ:

```text
Human ใช้ Browser ได้
+
AI มองหน้าเว็บได้
+
AI ควบคุม Browser ได้
+
ทุก Action ผ่าน Permission / Safety Gate
+
เชื่อมกับ MCP
```

แทนที่จะสร้าง Browser ใหม่ตั้งแต่ต้น ให้ใช้แนวคิดและโครงสร้างจาก:

```text
https://github.com/paddman/CYRVOR-CherryBrowser
```

เป็น Reference / Starting Point สำหรับ Browser Shell

จากนั้นพัฒนา Layer ของ Pao-hubPro เพิ่มเข้าไป

---

# 2. เป้าหมายหลัก

Pao-hubPro Browser ต้องสามารถทำงานเป็น Browser ที่ใช้ร่วมกันระหว่าง:

- ผู้ใช้
- ChatGPT
- Codex
- Local AI
- Claude
- MCP Client
- Pao-hubPro Orchestrator
- Workflow Automation
- Adobe Stock Automation
- Pao AI Generation Studio
- Browser Agent

Architecture เป้าหมาย:

```text
┌─────────────────────────────────────────────┐
│                 AI Clients                  │
│                                             │
│ ChatGPT / Codex / Claude / Local AI         │
└───────────────────┬─────────────────────────┘
                    │
                    │ MCP
                    ▼
┌─────────────────────────────────────────────┐
│              Pao-hubPro Core                │
│                                             │
│ Orchestrator                                │
│ Tool Registry                               │
│ Permission Engine                           │
│ Reviewer Council                            │
│ Audit Log                                   │
│ Workflow Engine                             │
└───────────────────┬─────────────────────────┘
                    │
                    │ Browser MCP
                    ▼
┌─────────────────────────────────────────────┐
│          Pao-hubPro Browser Bridge          │
│                                             │
│ MCP Server                                  │
│ Browser RPC                                 │
│ Action Validator                            │
│ Safety Gate                                 │
│ Session Manager                             │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│            Pao-hubPro Browser               │
│                                             │
│ Electron                                    │
│ Chromium                                    │
│ WebContentsView                             │
│ Tabs                                        │
│ Workspaces                                  │
│ Cookies / Sessions                          │
│ Downloads                                   │
│ Page Extraction                             │
│ Browser UI                                  │
└───────────────────┬─────────────────────────┘
                    │
                    ▼
                   WEB
```

---

# 3. หลักการสำคัญ

## 3.1 Human + AI Browser

Browser ต้องไม่ใช่ Headless Browser อย่างเดียว

ผู้ใช้ต้องสามารถ:

- เปิดดูหน้าเว็บจริง
- Login เอง
- ใช้ Mouse / Keyboard
- ดูว่า Agent กำลังทำอะไร
- หยุด Agent ได้ทันที
- Override การควบคุมได้
- Approve Action สำคัญได้

AI สามารถ:

- อ่านหน้าเว็บ
- ดู DOM
- ดู Text
- ดู Link
- ดู Form
- Click
- Type
- Scroll
- Download
- Upload
- Switch Tab
- เปิดหน้าใหม่
- ทำ Workflow

---

# 4. ขอบเขต Phase 20.11

Phase นี้เน้นสร้าง Foundation ก่อน

## Included

```text
✓ Browser Shell
✓ Browser MCP Bridge
✓ Browser Control API
✓ Page Extraction
✓ Tab Control
✓ Navigation
✓ Click
✓ Type
✓ Scroll
✓ Screenshot
✓ Download
✓ Session
✓ Safety Gate
✓ Audit Log
✓ Permission Policy
✓ Human Approval
✓ MCP Tool Registry
```

## Not Included Yet

```text
✗ Full autonomous purchasing
✗ Payment automation
✗ CAPTCHA bypass
✗ Stealth anti-detection
✗ Credential extraction
✗ Arbitrary unrestricted JavaScript execution
✗ Fully autonomous account creation
```

---

# 5. Browser Engine

Pao-hubPro Browser ใช้:

```text
Electron
+
Chromium
+
WebContentsView
```

เพื่อให้ได้ Browser จริงพร้อม UI

ข้อดี:

- ผู้ใช้มองเห็น Browser
- Session อยู่ใน Browser
- Cookies อยู่ใน Browser
- Login Session ใช้ต่อได้
- Browser Agent ใช้หน้าเดียวกับผู้ใช้
- รองรับหลาย Tab
- รองรับหลาย Workspace
- รองรับ Download
- รองรับ Browser Event

---

# 6. การตั้งชื่อ

ไม่ใช้ชื่อ:

```text
CherryBrowser
CYRVOR
Cherry
```

สำหรับ Product หลักของเรา

ใช้ชื่อ:

```text
Pao-hubPro Browser
```

Internal package:

```text
pao-hubpro-browser
```

Service:

```text
pao-browser
```

MCP Server:

```text
pao-browser-mcp
```

Bridge:

```text
pao-browser-bridge
```

---

# 7. Branding Rule

หากใช้ Source Code หรือ Architecture จาก Project ต้นแบบ:

ให้แยก:

```text
Source Code
```

ออกจาก:

```text
Logo
Artwork
Characters
Brand Assets
Product Name
```

Pao-hubPro Browser ต้องใช้ Branding ของตัวเอง

เช่น:

```text
Pao-hubPro Browser
Pao Browser
PB
```

ก่อนนำไปแจกจ่ายหรือใช้เชิงพาณิชย์ ให้ตรวจสอบ License ของ upstream version ที่ใช้อยู่จริงอีกครั้ง

---

# 8. Browser MCP Architecture

สร้าง MCP Server สำหรับ Browser โดยเฉพาะ

```text
Pao-hubPro
      │
      │ MCP
      ▼
pao-browser-mcp
      │
      │ JSON-RPC / IPC / WebSocket
      ▼
pao-browser-bridge
      │
      ▼
Electron Main Process
      │
      ▼
WebContentsView
      │
      ▼
Web Page
```

---

# 9. MCP Tools — Core

## 9.1 Browser Status

```text
browser.status
```

Return:

```json
{
  "running": true,
  "version": "0.1.0",
  "activeWorkspace": "default",
  "activeTabId": "tab_001",
  "tabs": 3
}
```

---

## 9.2 List Tabs

```text
browser.list_tabs
```

Return:

```json
[
  {
    "id": "tab_001",
    "title": "Adobe Stock",
    "url": "https://stock.adobe.com/",
    "active": true
  }
]
```

---

# 10. Navigation Tools

```text
browser.open
browser.navigate
browser.back
browser.forward
browser.reload
browser.stop
```

Example:

```json
{
  "tool": "browser.navigate",
  "arguments": {
    "url": "https://stock.adobe.com/"
  }
}
```

---

# 11. Tab Tools

```text
browser.new_tab
browser.close_tab
browser.activate_tab
browser.list_tabs
browser.get_active_tab
browser.duplicate_tab
```

---

# 12. Page Reading Tools

```text
browser.read_page
browser.get_text
browser.get_title
browser.get_url
browser.get_links
browser.get_elements
browser.get_forms
browser.get_buttons
browser.get_inputs
```

---

# 13. Page Snapshot

สร้าง Structured Snapshot

```text
browser.snapshot
```

ตัวอย่าง:

```json
{
  "url": "https://example.com",
  "title": "Example",
  "elements": [
    {
      "ref": "e1",
      "role": "button",
      "name": "Login"
    },
    {
      "ref": "e2",
      "role": "textbox",
      "name": "Email"
    }
  ]
}
```

Agent สามารถใช้:

```text
e1
e2
e3
```

แทน selector ยาว ๆ

เช่น:

```text
browser.click(ref="e1")
```

---

# 14. Interaction Tools

```text
browser.click
browser.double_click
browser.type
browser.fill
browser.clear
browser.select
browser.check
browser.uncheck
browser.hover
browser.focus
browser.press_key
browser.scroll
```

---

# 15. Element Targeting Strategy

ลำดับการหา Element:

```text
1. Snapshot Ref
2. ARIA Role
3. Accessible Name
4. Label
5. Text
6. CSS Selector
```

หลีกเลี่ยง XPath เป็น Default

เพื่อให้ Workflow ทนต่อการเปลี่ยน DOM มากขึ้น

---

# 16. Screenshot Tools

```text
browser.screenshot
browser.screenshot_element
```

Options:

```json
{
  "fullPage": false
}
```

หรือ:

```json
{
  "elementRef": "e15"
}
```

---

# 17. Download Tools

```text
browser.get_downloads
browser.wait_download
browser.cancel_download
browser.open_download
browser.reveal_download
```

ทุก Download ต้องบันทึก:

```text
URL
Filename
MIME
Size
Timestamp
InitiatedBy
Agent
Workflow ID
```

---

# 18. Upload Tool

```text
browser.upload_file
```

ต้องใช้ File Allowlist

ตัวอย่าง:

```json
{
  "elementRef": "e22",
  "file": "/approved/assets/image001.jpg"
}
```

Agent ห้ามเลือกไฟล์ใด ๆ ในเครื่องแบบ unrestricted

---

# 19. Session Management

รองรับ:

```text
browser.list_sessions
browser.create_session
browser.activate_session
browser.clear_session
```

Session แยกตาม:

```text
Workspace
Profile
Automation
Project
```

เช่น:

```text
AdobeStock
YouTube
TikTok
Research
Personal
Testing
```

---

# 20. Workspace

ตัวอย่าง:

```text
Workspace: Adobe Stock
├─ Adobe Stock
├─ ComfyUI
├─ Runpod
└─ Pao AI Generation Studio
```

อีก Workspace:

```text
Workspace: Pao-hubPro Dev
├─ GitHub
├─ OpenAI
├─ Codex
└─ Documentation
```

---

# 21. Safety Levels

แบ่ง Browser Action เป็น 4 ระดับ

## Level 0 — READ

อนุญาตอัตโนมัติ

```text
read_page
get_text
get_links
snapshot
screenshot
get_title
get_url
list_tabs
```

---

## Level 1 — LOW RISK

อนุญาตตาม Policy

```text
scroll
switch_tab
open_tab
navigate
hover
```

---

## Level 2 — CONTROLLED

ต้องผ่าน Policy Engine

```text
click
type
fill
select
download
upload
```

---

## Level 3 — CONFIRM REQUIRED

ต้องให้ Human Approve

```text
Submit Form
Send Message
Publish
Delete
Account Change
Login Credential Submission
Purchase
Payment
Subscription
Upload Sensitive File
```

---

# 22. Human Approval Gate

Flow:

```text
Agent
  │
  ▼
Action Proposal
  │
  ▼
Risk Classifier
  │
  ├── SAFE
  │      │
  │      ▼
  │   Execute
  │
  └── HIGH RISK
         │
         ▼
     Approval UI
         │
      ┌──┴──┐
      │     │
   Approve Reject
      │
      ▼
   Execute
```

---

# 23. Approval UI

แสดง:

```text
Agent:
Codex

Action:
Submit Form

Website:
stock.adobe.com

Reason:
Submit generated asset metadata

Affected Data:
Title
Keywords
Category

[Approve Once]

[Approve For Session]

[Reject]
```

---

# 24. Kill Switch

ต้องมีปุ่ม:

```text
STOP AGENT
```

เมื่อกด:

```text
- Cancel pending browser actions
- Stop active workflow
- Disable MCP browser control
- Preserve session
- Write audit log
```

Shortcut แนะนำ:

```text
Ctrl + Shift + Esc
```

สำหรับ Pao-hubPro Browser Agent Stop

---

# 25. Audit Log

ทุก Action บันทึก:

```json
{
  "timestamp": "2026-09-08T16:00:00+07:00",
  "agent": "codex",
  "workflowId": "wf_123",
  "tool": "browser.click",
  "target": "Submit",
  "url": "https://example.com",
  "risk": "controlled",
  "approved": true,
  "result": "success"
}
```

---

# 26. Audit Storage

แนะนำใช้:

```text
SQLite
```

Table:

```sql
browser_action_logs
```

Fields:

```text
id
timestamp
agent
workflow_id
tab_id
session_id
tool
arguments
url
risk_level
approval_status
result
error
duration_ms
```

---

# 27. Browser Policy File

สร้าง:

```text
config/browser-policy.yaml
```

ตัวอย่าง:

```yaml
default_policy: safe

allow:
  read:
    - "*"

  navigate:
    - "*"

confirm:
  actions:
    - submit
    - publish
    - send_message
    - delete
    - purchase
    - payment

deny:
  actions:
    - export_passwords
    - read_browser_password_store
    - arbitrary_shell
```

---

# 28. Domain Policy

สามารถกำหนด Domain ได้

```yaml
domains:

  stock.adobe.com:
    allow:
      - read
      - click
      - type
      - upload
    confirm:
      - submit
      - publish

  github.com:
    allow:
      - read
      - navigate
    confirm:
      - create_issue
      - merge
      - delete
```

---

# 29. Credential Policy

Agent ห้าม:

```text
read saved passwords
export saved passwords
dump cookies
dump auth tokens
```

Agent สามารถ:

```text
ใช้ Session ที่ผู้ใช้ Login ไว้
```

แต่ไม่สามารถดึง Credential ออกมาเป็น Plaintext

---

# 30. JavaScript Execution Policy

ไม่สร้าง Tool แบบ:

```text
browser.execute_javascript
```

เป็น Tool Public สำหรับ Agent

เพราะมีสิทธิ์กว้างเกินไป

ให้ Bridge ใช้ JavaScript ภายในเฉพาะ Operation ที่ผ่าน Validation แล้ว

เช่น:

```text
read_page
click
type
snapshot
```

---

# 31. Browser Bridge

สร้าง:

```text
src/browser-bridge/
```

Responsibilities:

```text
Receive MCP command
Validate schema
Validate permissions
Resolve tab
Resolve element
Execute action
Capture result
Audit
Return response
```

---

# 32. Proposed Project Structure

```text
pao-hubpro-browser/
│
├─ apps/
│  └─ desktop/
│
├─ src/
│  ├─ main/
│  │  ├─ browser-manager.js
│  │  ├─ tab-manager.js
│  │  ├─ workspace-manager.js
│  │  ├─ session-manager.js
│  │  ├─ download-manager.js
│  │  └─ permission-manager.js
│  │
│  ├─ renderer/
│  │  ├─ browser-ui/
│  │  ├─ approval-ui/
│  │  └─ agent-status/
│  │
│  ├─ bridge/
│  │  ├─ browser-bridge.js
│  │  ├─ action-validator.js
│  │  └─ action-runner.js
│  │
│  ├─ extraction/
│  │  ├─ page-reader.js
│  │  ├─ snapshot.js
│  │  ├─ element-resolver.js
│  │  └─ accessibility-tree.js
│  │
│  ├─ security/
│  │  ├─ policy-engine.js
│  │  ├─ risk-classifier.js
│  │  ├─ approval-manager.js
│  │  └─ audit-log.js
│  │
│  └─ shared/
│
├─ mcp/
│  ├─ server.js
│  ├─ tools/
│  │  ├─ browser-status.js
│  │  ├─ browser-tabs.js
│  │  ├─ browser-navigation.js
│  │  ├─ browser-read.js
│  │  ├─ browser-interaction.js
│  │  ├─ browser-download.js
│  │  └─ browser-screenshot.js
│  │
│  └─ schemas/
│
├─ config/
│  └─ browser-policy.yaml
│
├─ data/
│  └─ browser.db
│
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  ├─ security/
│  └─ e2e/
│
├─ docs/
│
├─ package.json
└─ README.md
```

---

# 33. MCP Tool Naming Convention

ใช้:

```text
browser.*
```

ไม่ใช้ชื่อผูกกับ implementation

ตัวอย่างถูก:

```text
browser.click
browser.navigate
browser.snapshot
```

ไม่ใช้:

```text
electron.click
chromium.click
webcontents.click
```

เพื่อให้อนาคตเปลี่ยน Engine ได้

---

# 34. Tool Schema Example

## browser.click

Input:

```json
{
  "tabId": "tab_001",
  "ref": "e12",
  "button": "left"
}
```

Output:

```json
{
  "success": true,
  "url": "https://example.com/dashboard"
}
```

---

# 35. browser.type

Input:

```json
{
  "tabId": "tab_001",
  "ref": "e7",
  "text": "hello world"
}
```

Sensitive Input:

```json
{
  "sensitive": true
}
```

ห้าม Sensitive Input ไปอยู่ใน:

```text
logs
console
debug output
AI context
```

---

# 36. Snapshot + Ref System

Pao-hubPro Browser ควรใช้ Element Ref แบบ:

```text
e1
e2
e3
e4
```

Snapshot:

```text
[e1] link "Dashboard"
[e2] button "Upload"
[e3] textbox "Title"
[e4] textbox "Keywords"
[e5] button "Submit"
```

AI จึงสั่ง:

```text
click e2
type e3
type e4
click e5
```

แทนการเดา DOM Selector

---

# 37. Self-Healing Element Resolver

หาก Element Ref เก่าหาย:

Resolver ลองหาใหม่จาก:

```text
role
name
text
label
nearby element
previous selector
DOM similarity
```

Flow:

```text
Old Ref
  ↓
Not Found
  ↓
Search Candidate
  ↓
Confidence Score
  ↓
>= threshold
  ↓
Remap Ref
```

Phase นี้ทำ Foundation ไว้ก่อน

Advanced Self-Healing สามารถต่อใน Phase 20.12

---

# 38. Agent Status Indicator

Browser UI ต้องแสดง:

```text
AI CONTROL: ON
```

หรือ

```text
AI CONTROL: OFF
```

เมื่อ Agent ทำงาน:

```text
Codex is controlling this tab
```

แสดง Tool ปัจจุบัน:

```text
Reading page...
Clicking Upload...
Waiting for download...
```

---

# 39. Browser Event Stream

สร้าง Events:

```text
browser.tab.created
browser.tab.closed
browser.tab.changed
browser.navigation.started
browser.navigation.completed
browser.download.started
browser.download.completed
browser.action.started
browser.action.completed
browser.approval.required
```

---

# 40. Event Architecture

```text
Browser
  │
  ▼
Event Bus
  │
  ├─ MCP
  ├─ Audit
  ├─ UI
  └─ Workflow Engine
```

---

# 41. Workflow Support

โครงสร้าง Workflow:

```yaml
name: Adobe Stock Upload

steps:

  - browser.navigate:
      url: https://contributor.stock.adobe.com/

  - browser.snapshot: {}

  - browser.click:
      target: Upload

  - browser.upload_file:
      file: "{{asset.path}}"

  - browser.fill:
      target: Title
      value: "{{asset.title}}"

  - browser.fill:
      target: Keywords
      value: "{{asset.keywords}}"

  - approval:
      reason: Submit asset

  - browser.click:
      target: Submit
```

---

# 42. Integration กับ Pao-hubPro

Browser ไม่ทำ Orchestration เองทั้งหมด

ให้:

```text
Pao-hubPro Core
```

เป็น Brain

Browser เป็น:

```text
Eyes
+
Hands
+
Session
```

Architecture:

```text
Pao-hubPro Core
   │
   ├─ Planner
   ├─ Reviewer Council
   ├─ Workflow
   ├─ Memory
   ├─ Policy
   │
   ▼
Pao-hubPro Browser
   │
   ▼
Internet
```

---

# 43. Integration กับ Reviewer Council

High-Risk Browser Action สามารถให้ Reviewer Council ตรวจ

ตัวอย่าง:

```text
Codex:
"ต้องการกด Publish"

        ↓

Reviewer Council

ChatGPT
Claude
Local AI

        ↓

Risk / Intent Review

        ↓

Human Approval

        ↓

Execute
```

---

# 44. Adobe Stock Use Case

Pao-hubPro Browser สามารถใช้กับ Adobe Stock Workflow:

```text
Pao AI Generation Studio
       │
       ▼
Generated Asset
       │
       ▼
Reviewer Council
       │
       ▼
Metadata Generator
       │
       ▼
Pao-hubPro Browser
       │
       ▼
Adobe Stock Contributor
```

Browser สามารถ:

```text
Open contributor
Upload image
Fill title
Fill keywords
Choose category
Read validation error
Prepare submission
```

ขั้น Submit จริง:

```text
Human Approval
```

เป็น Default

---

# 45. Download Workflow

ตัวอย่าง:

```text
Agent:
Download generated file

Browser:
Start download

Download Manager:
Track status

Pao-hubPro:
Wait completion

File Tool:
Validate file

Reviewer:
Inspect

Pipeline:
Continue
```

---

# 46. Security Requirements

ต้องผ่านทุกข้อ:

```text
[ ] nodeIntegration disabled ใน web content
[ ] contextIsolation enabled
[ ] sandbox enabled
[ ] webSecurity enabled
[ ] no unrestricted executeJavaScript MCP tool
[ ] no password dumping
[ ] no cookie dumping
[ ] no unrestricted filesystem
[ ] upload file allowlist
[ ] domain policy
[ ] action policy
[ ] audit log
[ ] human approval
[ ] kill switch
```

---

# 47. Electron Security

Browser web content ต้องใช้:

```javascript
nodeIntegration: false
contextIsolation: true
sandbox: true
webSecurity: true
allowRunningInsecureContent: false
```

Preload ต้อง expose เฉพาะ API ที่จำเป็น

ห้าม:

```text
require
fs
child_process
shell
ipcRenderer raw access
```

ไปยัง Web Page

---

# 48. IPC Security

ทุก IPC Channel ต้อง:

```text
Validate sender
Validate schema
Validate arguments
Validate permissions
Validate tab
Validate origin when applicable
```

ห้ามสร้าง:

```text
ipc.invoke("execute-anything")
```

---

# 49. MCP Security

MCP Server ต้อง bind:

Default:

```text
127.0.0.1
```

ไม่ bind:

```text
0.0.0.0
```

โดย Default

หากต้อง Remote:

ต้องมี:

```text
Authentication
TLS / secure tunnel
Token
Device approval
IP policy
```

---

# 50. Local Communication

แนะนำ:

```text
MCP stdio
```

สำหรับ Local Client

และ:

```text
localhost WebSocket
```

สำหรับ Browser Bridge

เช่น:

```text
ws://127.0.0.1:17891
```

แต่ Port ต้อง configurable

---

# 51. Authentication

Bridge Token:

```text
random 256-bit secret
```

สร้างตอนติดตั้งหรือ startup

เก็บด้วย Secure Storage ของ OS เมื่อทำได้

ทุก connection ต้อง authenticate

---

# 52. Phase Implementation Order

## Step 1 — Fork / Bootstrap

```text
Create pao-hubpro-browser
Remove upstream branding
Rename package
Update metadata
```

---

## Step 2 — Browser Core

ตรวจ:

```text
Window
Tabs
Navigation
WebContentsView
Workspace
Session
Download
```

---

## Step 3 — Page Extraction

สร้าง:

```text
read_page
snapshot
elements
links
forms
```

---

## Step 4 — Browser Bridge

สร้าง:

```text
Browser RPC
Action Runner
Element Resolver
```

---

## Step 5 — MCP Server

สร้าง:

```text
pao-browser-mcp
```

Tools ชุดแรก:

```text
browser.status
browser.list_tabs
browser.navigate
browser.read_page
browser.snapshot
browser.click
browser.type
browser.scroll
browser.screenshot
```

---

## Step 6 — Safety Gate

สร้าง:

```text
Policy Engine
Risk Classifier
Approval
Audit
Kill Switch
```

---

## Step 7 — Download

เพิ่ม:

```text
downloads
wait_download
download events
```

---

## Step 8 — Session

เพิ่ม:

```text
workspace
profile
session
```

---

## Step 9 — Tests

Unit

Integration

Security

E2E

---

# 53. MVP Tool Set

Phase 20.11 MVP ต้องมีอย่างน้อย:

```text
browser.status

browser.list_tabs
browser.new_tab
browser.close_tab
browser.activate_tab

browser.navigate
browser.back
browser.forward
browser.reload

browser.get_url
browser.get_title
browser.read_page
browser.snapshot

browser.click
browser.type
browser.press_key
browser.scroll

browser.screenshot

browser.get_downloads
browser.wait_download
```

---

# 54. Phase 20.11 Acceptance Criteria

ถือว่า Phase เสร็จเมื่อ:

```text
[ ] Pao-hubPro Browser เปิดใช้งานได้บน Windows
[ ] เปิดเว็บไซต์จริงได้
[ ] หลาย Tab ใช้งานได้
[ ] Session อยู่หลัง Restart ตาม design
[ ] MCP Client เชื่อม Browser ได้
[ ] AI อ่านหน้าเว็บได้
[ ] AI อ่าน element snapshot ได้
[ ] AI navigate ได้
[ ] AI click ได้
[ ] AI type ได้
[ ] AI scroll ได้
[ ] AI screenshot ได้
[ ] AI switch tab ได้
[ ] Download event ใช้งานได้
[ ] High-risk action มี approval gate
[ ] ทุก action มี audit log
[ ] มี Agent Stop / Kill Switch
[ ] MCP ไม่ expose arbitrary JS execution
[ ] Browser page ไม่มี Node.js access
[ ] Security tests ผ่าน
[ ] E2E smoke test ผ่าน
```

---

# 55. Test Scenario 1

## Basic Browser Control

```text
1. Start Pao-hubPro Browser

2. MCP:
browser.status

3. MCP:
browser.navigate
https://example.com

4. MCP:
browser.read_page

5. MCP:
browser.snapshot

6. MCP:
browser.click

7. Verify URL

PASS
```

---

# 56. Test Scenario 2

## Tab Control

```text
Open Tab A

Open Tab B

List tabs

Activate A

Read URL

Activate B

Read URL

Close B

PASS
```

---

# 57. Test Scenario 3

## Human Approval

Agent attempts:

```text
Submit Form
```

Expected:

```text
Execution paused

Approval UI shown

Human clicks Approve

Action executed

Audit log created
```

---

# 58. Test Scenario 4

## Reject

Agent attempts high-risk action

Human:

```text
Reject
```

Expected:

```text
No action executed

Agent receives:
ACTION_REJECTED

Audit log records rejection
```

---

# 59. Test Scenario 5

## Kill Switch

While Agent running:

```text
Click STOP AGENT
```

Expected:

```text
All pending browser tasks cancelled

New MCP control commands rejected

Manual Browser remains usable
```

---

# 60. Test Scenario 6

## Security

Try calling:

```text
browser.execute_javascript
```

Expected:

```text
TOOL_NOT_FOUND
```

Try:

```text
read_password_store
```

Expected:

```text
DENIED
```

---

# 61. Logging

แบ่ง Log:

```text
App Log
Browser Log
MCP Log
Audit Log
Security Log
```

Sensitive data ต้อง redact

ตัวอย่าง:

```text
Authorization: [REDACTED]

Cookie: [REDACTED]

Password: [REDACTED]
```

---

# 62. Error Codes

กำหนด:

```text
BROWSER_NOT_RUNNING

TAB_NOT_FOUND

ELEMENT_NOT_FOUND

NAVIGATION_FAILED

ACTION_DENIED

APPROVAL_REQUIRED

ACTION_REJECTED

DOWNLOAD_FAILED

TIMEOUT

SESSION_NOT_FOUND

INVALID_ARGUMENT

SECURITY_POLICY_DENIED
```

---

# 63. Observability

Dashboard แสดง:

```text
Browser Status

Connected Agents

Active Tab

Current Workflow

Current Action

Pending Approval

Downloads

Recent Actions

Errors
```

---

# 64. Future Phase 20.12

หลัง Phase 20.11 สามารถต่อ:

# Phase 20.12 — Pao-hubPro Browser Workflow Intelligence

Features:

```text
Workflow Recorder
Replay
Self-Healing
Semantic Element Matching
Browser Task Memory
Visual Validation
Retry Engine
Recovery
Checkpoint
Resume
```

---

# 65. Future Phase 20.13

# Pao-hubPro Browser Multi-Agent Web Operations

```text
Research Agent
Upload Agent
Reviewer Agent
Metadata Agent
QA Agent
Human Supervisor
```

---

# 66. Future Phase 20.14

# Pao-hubPro Browser Remote Worker

ทำให้ Browser Worker รันบน:

```text
PC
VPS
Cloud VM
Runpod-compatible utility VM
```

โดยยังควบคุมผ่าน Pao-hubPro

---

# 67. Recommended Development Strategy

อย่าพยายามทำทุกอย่างในครั้งเดียว

ลำดับแนะนำ:

```text
Browser Core

↓

Read Page

↓

Snapshot

↓

MCP

↓

Click / Type

↓

Safety Gate

↓

Download

↓

Workflow

↓

Self-Healing
```

จุดสำคัญที่สุดคือ:

```text
Agent ต้องมองหน้าเว็บได้อย่างเสถียร
```

ก่อนทำ:

```text
Agent Autonomous Control
```

---

# 68. Definition of Done

Phase 20.11 ถือว่า Done เมื่อสามารถสั่งจาก MCP Client:

```text
เปิด Browser

เปิดเว็บไซต์

อ่านหน้าเว็บ

ดู Element

กดปุ่ม

พิมพ์ข้อความ

สลับ Tab

เลื่อนหน้า

จับ Screenshot

ติดตาม Download
```

และ:

```text
Action เสี่ยงถูกบล็อกหรือขออนุมัติ
```

โดย Browser ยังสามารถใช้ด้วยมือได้ตามปกติ

---

# 69. One-Shot Codex Implementation Prompt

คัดลอกทั้งหมดด้านล่างไปใช้กับ Codex ได้

```text
You are implementing Phase 20.11 of my Pao-hubPro project.

PROJECT NAME:
Pao-hubPro Browser

PHASE:
20.11

REFERENCE REPOSITORY:
https://github.com/paddman/CYRVOR-CherryBrowser

PRIMARY GOAL:
Build an agent-native Electron/Chromium desktop browser runtime that can be safely controlled by Pao-hubPro through MCP while remaining fully usable by a human.

IMPORTANT:
Do not simply rename the reference repository.

Use it only as a starting point/reference where legally and technically appropriate.

Remove or replace upstream product branding, artwork, characters, logos, names, and brand-specific assets.

Our product name is:

Pao-hubPro Browser

Internal names:

pao-hubpro-browser
pao-browser
pao-browser-mcp
pao-browser-bridge

Before reusing upstream source, inspect the exact license in the checked-out repository and preserve all notices required by that license.

DO NOT remove required copyright or license notices.

==================================================
CORE ARCHITECTURE
==================================================

AI CLIENTS

ChatGPT
Codex
Claude
Local AI

        |
        | MCP
        v

Pao-hubPro Core

Orchestrator
Tool Registry
Permission Engine
Reviewer Council
Audit Log
Workflow Engine

        |
        v

Pao Browser MCP Server

        |
        v

Pao Browser Bridge

        |
        v

Electron Main Process

        |
        v

WebContentsView / Chromium

        |
        v

WEB

==================================================
REQUIREMENTS
==================================================

The browser must remain a normal interactive desktop browser.

The human user must be able to:

- browse normally
- use keyboard and mouse
- login manually
- use existing sessions
- inspect what the agent is doing
- stop agent control immediately
- approve or reject sensitive actions

The AI must eventually be able to:

- inspect active browser state
- list tabs
- navigate
- read page text
- inspect structured page snapshots
- identify interactive elements
- click
- type
- press keys
- scroll
- switch tabs
- capture screenshots
- observe downloads

==================================================
MCP TOOLS — MVP
==================================================

Implement:

browser.status

browser.list_tabs
browser.new_tab
browser.close_tab
browser.activate_tab

browser.navigate
browser.back
browser.forward
browser.reload

browser.get_url
browser.get_title

browser.read_page
browser.snapshot

browser.click
browser.type
browser.press_key
browser.scroll

browser.screenshot

browser.get_downloads
browser.wait_download

Use JSON Schema / MCP schemas for all tool inputs and outputs.

==================================================
ELEMENT SNAPSHOT
==================================================

Implement an accessibility/semantic page snapshot.

Example:

[e1] link "Dashboard"
[e2] button "Upload"
[e3] textbox "Title"
[e4] textbox "Keywords"
[e5] button "Submit"

Agents should preferably act using stable short refs:

browser.click({ ref: "e2" })

instead of raw arbitrary JavaScript.

Element resolution priority:

1. snapshot ref
2. ARIA role
3. accessible name
4. label
5. text
6. CSS selector

Do not use XPath as the default strategy.

==================================================
SECURITY
==================================================

This project is security-sensitive.

Web content must run with Electron security best practices.

Required baseline:

nodeIntegration: false
contextIsolation: true
sandbox: true
webSecurity: true
allowRunningInsecureContent: false

Never expose Node.js primitives to arbitrary pages.

Never expose raw fs, shell, child_process, or unrestricted ipcRenderer to web pages.

Validate every IPC argument.

Validate the sender where applicable.

Do not expose a general-purpose MCP tool named:

browser.execute_javascript

Do not expose arbitrary JavaScript execution to agents.

Internal JavaScript execution may only be used behind validated high-level operations.

Do not expose:

password dumping
credential extraction
cookie dumping
token dumping

Agents may use an already authenticated browser session but must not be able to export credentials.

==================================================
MCP NETWORK SECURITY
==================================================

Default MCP/bridge networking must only bind to localhost.

Use:

127.0.0.1

Do not default to:

0.0.0.0

If a local WebSocket bridge is required, make the port configurable.

Example default:

127.0.0.1:17891

Use an authentication token between MCP server and browser bridge.

Generate a strong random secret.

Never log the secret.

==================================================
SAFETY LEVELS
==================================================

Create an action risk model.

LEVEL 0 — READ

read_page
snapshot
get_text
get_links
screenshot
get_title
get_url
list_tabs

LEVEL 1 — LOW RISK

scroll
switch_tab
open_tab
navigate
hover

LEVEL 2 — CONTROLLED

click
type
fill
select
download
upload

LEVEL 3 — CONFIRM REQUIRED

submit form
send message
publish
delete
account changes
credential submission
purchase
payment
subscription
sensitive upload

==================================================
APPROVAL SYSTEM
==================================================

Implement a human approval gate for high-risk actions.

Approval UI must show:

Agent
Action
Website
Reason
Affected data

Buttons:

Approve Once
Approve For Session
Reject

Rejected actions must never execute.

Return an explicit error/status:

ACTION_REJECTED

==================================================
KILL SWITCH
==================================================

Add a visible:

STOP AGENT

button.

When triggered:

- cancel pending agent actions
- stop current automated workflow
- disable new MCP control actions
- keep manual browser usage available
- preserve the normal browser session
- write an audit log entry

Create a keyboard shortcut if practical.

Recommended:

Ctrl + Shift + Esc

but avoid conflicting with operating system behavior; choose a safe alternative if necessary.

==================================================
POLICY ENGINE
==================================================

Create:

config/browser-policy.yaml

Support global and domain-specific policies.

Example:

default_policy: safe

confirm:
  actions:
    - submit
    - publish
    - send_message
    - delete
    - purchase
    - payment

deny:
  actions:
    - export_passwords
    - read_browser_password_store
    - arbitrary_shell

Support domain rules.

Example:

domains:

  stock.adobe.com:
    allow:
      - read
      - click
      - type
      - upload

    confirm:
      - submit
      - publish

==================================================
AUDIT LOG
==================================================

Every agent-controlled browser action must be auditable.

Use SQLite unless the repository already has a better compatible persistence architecture.

Suggested table:

browser_action_logs

Fields:

id
timestamp
agent
workflow_id
tab_id
session_id
tool
arguments
url
risk_level
approval_status
result
error
duration_ms

Sensitive values must be redacted.

Never log:

passwords
auth headers
cookies
access tokens
refresh tokens
secrets

==================================================
BROWSER EVENTS
==================================================

Create an internal browser event bus.

Events should include:

browser.tab.created
browser.tab.closed
browser.tab.changed

browser.navigation.started
browser.navigation.completed

browser.download.started
browser.download.completed

browser.action.started
browser.action.completed

browser.approval.required

Events should be consumable by:

MCP
UI
Audit
Workflow Engine

==================================================
DOWNLOAD SUPPORT
==================================================

Track downloads.

Implement:

browser.get_downloads
browser.wait_download

Capture:

filename
source URL when safe
MIME
size
status
timestamp
workflow id
initiating agent

==================================================
SESSION SUPPORT
==================================================

Preserve browser sessions safely.

Prepare architecture for named sessions/workspaces:

AdobeStock
Research
Development
Testing

Do not expose raw cookies to MCP clients.

==================================================
PROJECT STRUCTURE
==================================================

Prefer a structure similar to:

pao-hubpro-browser/

apps/
  desktop/

src/

  main/
    browser-manager
    tab-manager
    workspace-manager
    session-manager
    download-manager
    permission-manager

  renderer/
    browser-ui
    approval-ui
    agent-status

  bridge/
    browser-bridge
    action-validator
    action-runner

  extraction/
    page-reader
    snapshot
    element-resolver
    accessibility-tree

  security/
    policy-engine
    risk-classifier
    approval-manager
    audit-log

mcp/

  server
  tools/
  schemas/

config/
  browser-policy.yaml

data/
  browser.db

tests/

  unit/
  integration/
  security/
  e2e/

docs/

==================================================
TESTS
==================================================

Add automated tests.

UNIT:

policy engine
risk classifier
element resolver
schema validation

INTEGRATION:

MCP -> Browser Bridge
tab manager
page snapshot
navigation

SECURITY:

attempt unrestricted JS execution
attempt credential extraction
attempt invalid IPC
attempt non-local connection where applicable
attempt denied action

E2E:

start browser
open example.com
read page
snapshot
click link
switch tab
take screenshot

==================================================
ACCEPTANCE CRITERIA
==================================================

Phase 20.11 is complete only when:

[ ] Pao-hubPro Browser runs on Windows
[ ] browser opens normal websites
[ ] multiple tabs work
[ ] MCP connects to the browser
[ ] MCP can list tabs
[ ] MCP can navigate
[ ] MCP can read the page
[ ] MCP can create an element snapshot
[ ] MCP can click
[ ] MCP can type
[ ] MCP can scroll
[ ] MCP can switch tabs
[ ] MCP can capture screenshots
[ ] downloads can be observed
[ ] high-risk actions require approval
[ ] rejection prevents execution
[ ] every automated action creates an audit event
[ ] kill switch stops agent control
[ ] manual browser usage remains available
[ ] arbitrary JS MCP execution is not exposed
[ ] credentials cannot be exported through MCP
[ ] Electron web content has no Node access
[ ] security tests pass
[ ] E2E smoke tests pass

==================================================
IMPLEMENTATION RULES
==================================================

1. Inspect the existing repository before modifying code.

2. Reuse stable architecture where appropriate instead of rewriting everything.

3. Do not break normal browser behavior.

4. Keep commits logically separated.

Suggested commits:

feat(browser): rebrand browser shell

feat(bridge): add browser control bridge

feat(mcp): add browser MCP server

feat(extraction): add semantic page snapshot

feat(security): add browser permission engine

feat(approval): add human approval UI

feat(audit): add browser action logging

feat(download): add download tracking

test(browser): add browser integration tests

test(security): add browser security tests

5. Run tests after each major subsystem.

6. Fix regressions before proceeding.

7. Do not claim a feature is complete if tests do not demonstrate it.

==================================================
FINAL OUTPUT
==================================================

When implementation is finished:

1. Run all available tests.

2. Run security tests.

3. Run E2E smoke tests.

4. Build the Windows application if the environment allows it.

5. Produce:

docs/PHASE-20.11-IMPLEMENTATION-REPORT.md

The report must contain:

- files changed
- architecture created
- MCP tools implemented
- security controls
- tests executed
- test results
- known limitations
- remaining TODOs
- exact run command
- exact build command

6. Update README with a section:

Pao-hubPro Browser MCP

including:

- how to start browser
- how to start MCP server
- how to connect a client
- available tools
- safety model
- approval behavior

Start by auditing the repository and creating a concrete implementation plan.

Then implement Phase 20.11 completely.

Do not stop after only writing the plan.

Continue through implementation, tests, documentation, and final verification unless blocked by a genuine environment limitation.
```

---

# 70. Recommended First Run

หลังจาก Codex ทำ Phase เสร็จ ให้ทดสอบลำดับนี้:

```text
1. npm install

2. npm test

3. npm run dev

4. เปิด Pao-hubPro Browser

5. เปิด example.com

6. Start MCP Server

7. เชื่อม MCP Client

8. browser.status

9. browser.list_tabs

10. browser.read_page

11. browser.snapshot

12. browser.click

13. browser.screenshot

14. ตรวจ Audit Log
```

---

# 71. Checklist สำหรับเปา

ก่อนถือว่าใช้งานจริง:

```text
[ ] Browser ใช้มือปกติได้

[ ] AI อ่านหน้าเว็บได้

[ ] AI Click ได้

[ ] AI Type ได้

[ ] MCP เชื่อมได้

[ ] Session ไม่หลุด

[ ] Password ไม่ถูก expose

[ ] Cookies ไม่ถูก expose

[ ] Arbitrary JS ไม่มี

[ ] Approval ใช้งานได้

[ ] Reject ใช้งานได้

[ ] STOP AGENT ใช้งานได้

[ ] Audit Log มีจริง

[ ] Download Tracking ใช้งานได้

[ ] Browser Crash แล้ว Recovery ได้

[ ] Security Tests ผ่าน

[ ] E2E Tests ผ่าน
```

---

# 72. Phase Result

เมื่อ Phase 20.11 เสร็จ:

Pao-hubPro จะไม่ได้มีเพียง:

```text
AI
+
MCP
+
Local Tools
```

แต่จะมี:

```text
AI
+
MCP
+
Local Tools
+
Browser Runtime
+
Human Approval
+
Browser Session
+
Web Automation
```

ทำให้ Pao-hubPro สามารถขยับจาก:

```text
AI Assistant
```

ไปสู่:

```text
Agentic Workspace
```

ที่สามารถทำงานจริงบน:

```text
Local PC
+
Browser
+
Web Apps
+
Cloud Services
+
AI Models
```

โดยยังคงมี Human Control และ Safety Gate เป็นแกนหลัก

---

# END OF PHASE 20.11

```text
Phase 20.11
Pao-hubPro Browser
Agent-Native Browser Runtime

Human + AI + MCP + Browser + Safety
```
