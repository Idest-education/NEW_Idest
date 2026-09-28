# ClickUp Reference

Guide for fetching project documents and tasks from ClickUp.

## Connection

- **Auth**: personal API token in the `CLICKUP_TOKEN` environment variable. Send it as the raw `Authorization` header value (no `Bearer` prefix).
- **REST base (tasks, spaces, folders, lists)**: `https://api.clickup.com/api/v2`
- **REST base (docs)**: `https://api.clickup.com/api/v3`
- **Rate limit**: 100 requests/minute per token (Free plan).
- The MCP ClickUp server (`mcp__clickup__*`) exists but currently returns `This connection has no authorized workspaces`. Use the REST API until that is fixed.
- In this environment raw `curl`/`wget` is redirected through context-mode. Run network calls inside `ctx_execute` (language `shell` or `python`) so the token stays in the sandbox env and the raw response body does not enter the conversation.

## Workspace identifiers

| Item | Name | ID |
| --- | --- | --- |
| Workspace (team) | Idest | `1100360000004414` |
| Space | Idest | `1100360000021475` |

### Folders (Space `1100360000021475`)

| Folder | ID | Contains |
| --- | --- | --- |
| Sprint Folder | `1100360000027332` | Sprint task lists |
| 01 Product Discovery | `1100360000026703` | docs only, no lists |
| 02 Requirements | `1100360000026704` | docs only, no lists |
| 03 System Design | `1100360000026706` | docs only, no lists |
| ADR | `1100360000027465` | docs only, no lists |
| 04 AI & ML | `1100360000026707` | docs only, no lists |
| 05 Thesis (KLTN) | `1100360000026709` | docs only, no lists |
| 06 Project Management | `1100360000026710` | docs only, no lists |

## Fetching tasks

Tasks live in lists inside **Sprint Folder** (`1100360000027332`).

| List | ID |
| --- | --- |
| Sprint 1 (7/9 - 20/9) | `1100360000028044` |
| Sprint 2 (21/9 - 4/10) | `1100360000028055` |

### Endpoints

```
GET /api/v2/folder/{folder_id}/list                       list the sprint lists
GET /api/v2/list/{list_id}/task?archived=false&include_closed=true    tasks in a list
GET /api/v2/task/{task_id}?include_subtasks=true          one task with detail
GET /api/v2/task/{task_id}/comment                        task comments
```

Key task fields: `id`, `name`, `status.status`, `assignees`, `due_date`, `description`, `subtasks`.

To discover lists again from scratch:

```
GET /api/v2/team/1100360000004414/space?archived=false
GET /api/v2/space/{space_id}/folder?archived=false
GET /api/v2/space/{space_id}/list?archived=false          folderless lists (none currently)
```

## Fetching documents

Docs use the v3 API and are keyed at the workspace level.

### Endpoints

```
GET  /api/v3/workspaces/1100360000004414/docs                              list all docs
GET  /api/v3/workspaces/1100360000004414/docs/{doc_id}/pageListing         page tree
GET  /api/v3/workspaces/1100360000004414/docs/{doc_id}/pages?content_format=text%2Fmd   page content as Markdown
POST /api/v3/workspaces/1100360000004414/docs                              create a doc
POST /api/v3/workspaces/1100360000004414/docs/{doc_id}/pages               create a page
PUT  /api/v3/workspaces/1100360000004414/docs/{doc_id}/pages/{page_id}     replace page content
```

Create a doc with `{"name", "parent": {"id": "<folder_id>", "type": 5}, "visibility": "PUBLIC", "create_page": false}`.
`parent.type` is `4` space, `5` folder, `6` list, `7` everything, `12` workspace.
Create or replace a page with `{"name", "content", "content_format": "text/md"}`; the `PUT` also takes
`"content_edit_mode": "replace"` and returns an empty body on success, so verify with a follow-up `GET`.
ClickUp normalises the Markdown it stores — `- ` becomes `*   ` and `## 4.` becomes `## 4\.` — so compare
round-tripped content loosely, not byte for byte.

`content_format` accepts `text/md` (URL-encoded `text%2Fmd`) or `text/plain`.
Page objects contain `id`, `name`, `content`.

### Known docs

| Doc | ID | Area |
| --- | --- | --- |
| Product Vision | `z8rp3etr9y-118` | Product Discovery |
| Target User | `z8rp3etr9y-158` | Product Discovery |
| User Roles & Responsibilities | `z8rp3etr9y-198` | Product Discovery |
| Product Scope | `z8rp3etr9y-218` | Product Discovery |
| Functional requirements | `z8rp3etr9y-258` | Requirements |
| Non-Functional requirements | `z8rp3etr9y-278` | Requirements |
| System Architecture | `z8rp3etr9y-298` | System Design |
| Domain & Data Design | `z8rp3etr9y-318` | System Design |
| Database Schema | `z8rp3etr9y-338` | System Design |
| Core User Flows | `z8rp3etr9y-358` | System Design |
| Assessment Analytics & Decision Tracking | `z8rp3etr9y-718` | System Design |
| Teacher Onboarding (Checklist + Spotlight) | `z8rp3etr9y-738` | System Design |
| AI Scoring & Evaluation (SƠ KHAI) | `z8rp3etr9y-378` | AI & ML |
| 001: Document database and JsonB on Relational database | `z8rp3etr9y-538` | ADR |
| 002: Essay Submission Method | `z8rp3etr9y-558` | ADR |
| 003: Initial AI Scoring Approach | `z8rp3etr9y-578` | ADR |

Doc IDs are stable but the list above is a snapshot. Re-run the `docs` listing endpoint to pick up new or renamed docs.

## Example: dump all docs to Markdown

```python
import json, subprocess, os

TEAM = "1100360000004414"
H = ["-H", "Authorization: " + os.environ["CLICKUP_TOKEN"]]

def get(url):
    r = subprocess.run(["curl", "-s", url] + H, capture_output=True, text=True)
    return json.loads(r.stdout)

docs = get(f"https://api.clickup.com/api/v3/workspaces/{TEAM}/docs")["docs"]
for d in docs:
    pages = get(
        f"https://api.clickup.com/api/v3/workspaces/{TEAM}/docs/{d['id']}"
        "/pages?content_format=text%2Fmd"
    )
    print(f"\n\n# {d['name']} ({d['id']})")
    for p in pages:
        print(f"\n## {p.get('name')}\n\n{p.get('content') or ''}")
```

## Example: list tasks in both sprints

```python
import json, subprocess, os

H = ["-H", "Authorization: " + os.environ["CLICKUP_TOKEN"]]
LISTS = {
    "Sprint 1": "1100360000028044",
    "Sprint 2": "1100360000028055",
}

def get(url):
    r = subprocess.run(["curl", "-s", url] + H, capture_output=True, text=True)
    return json.loads(r.stdout)

for name, list_id in LISTS.items():
    data = get(
        f"https://api.clickup.com/api/v2/list/{list_id}"
        "/task?archived=false&include_closed=true"
    )
    print(f"\n{name}")
    for t in data["tasks"]:
        print(f"  {t['id']}  [{t['status']['status']}]  {t['name']}")
```
