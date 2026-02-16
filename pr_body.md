## Summary
- implement `analyzeEmail(email)` to return strict JSON with a fixed schema
- add `POST /triage` accepting either `{ messageId }` or `{ subject, from, snippet }`
- fetch Gmail metadata by message ID when `messageId` is provided
- validate request body with zod and return explicit status codes for invalid input/auth/not-found/server errors

## Example request/response

### 1) Direct payload (no Gmail fetch)
Request:
```bash
curl -X POST http://localhost:3000/triage \
  -H "Content-Type: application/json" \
  -d '{"subject":"Invoice overdue","from":"billing@vendor.com","snippet":"Please pay within 24 hours."}'
```

Response (200):
```json
{
  "analysis": {
    "priority": "urgent",
    "category": "finance",
    "action": "reply",
    "summary": "Vendor requests immediate payment for an overdue invoice.",
    "draftReply": "Thanks for the reminder. We are reviewing this invoice and will confirm payment timing shortly."
  }
}
```

### 2) Gmail by messageId
Request:
```bash
curl -X POST http://localhost:3000/triage \
  -H "Content-Type: application/json" \
  -d '{"messageId":"18f7abc12345"}'
```

Response (200):
```json
{
  "email": {
    "id": "18f7abc12345",
    "threadId": "18f7abc11111",
    "snippet": "...",
    "subject": "Security alert",
    "from": "security@example.com",
    "date": "Mon, 15 Feb 2026 09:00:00 +0000"
  },
  "analysis": {
    "priority": "urgent",
    "category": "security",
    "action": "reply",
    "summary": "A security warning requires quick user confirmation.",
    "draftReply": "Thanks for the alert. I am reviewing this now and will follow your recommended steps immediately."
  }
}
```

## Minimal test steps
1. Set `OPENAI_API_KEY` in environment and start backend: `npm.cmd run dev` (inside `backend`).
2. Call `POST /triage` with `{ subject, from, snippet }` and verify `analysis` matches strict schema.
3. Call `POST /triage` with invalid body (e.g. `{}`) and verify `400 Invalid request body`.
4. Without OAuth token, call with `{ messageId }` and verify `401 Unauthorized`.
5. After `/auth/google` + `/oauth2callback`, call with a valid `messageId` and verify `{ email, analysis }` response.
