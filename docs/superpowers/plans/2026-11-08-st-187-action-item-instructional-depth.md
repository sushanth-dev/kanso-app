# ST-187 Action Item Instructional Depth Implementation Plan

Connect curriculum action items to targeted calculation drill sessions in the practice gym, replacing passive reading comprehension with active pattern training.

User review required: No. Minimal, direct bridge using existing practice route and schemas.

## Proposed Changes

### 1. API Contract and Endpoint (`apps/api/src/contract/schemas.ts`, `apps/api/src/report/report.ts`)
- In `apps/api/src/contract/schemas.ts`:
  Add `groupKey: z.string()` to `ActionItemList.items`.
- In `apps/api/src/report/report.ts`:
  In `listActionItems` handler, include `groupKey: item.groupKey` in mapped output.
- Run `npm run openapi && npm run generate` to update `openapi.json` and `@kanso/api` TypeScript types.

### 2. Client Routing (`apps/web/src/router.tsx`)
- In `router.tsx` `practiceRoute.validateSearch`:
  Validate `actionItemId?: string` (string length > 0 and <= 36).

### 3. Curriculum Route Action Link (`apps/web/src/routes/curriculum-route.tsx`)
- In `CurriculumCard`:
  Add calculation drill link to `/practice`:
  `/practice?kind=${item.kind}&group=${encodeURIComponent(item.groupKey)}&actionItemId=${item.id}&label=${encodeURIComponent(item.label)}`
  Rendered clearly as:
  `Practice calculation drills`

### 4. Practice Gym Completion Return (`apps/web/src/routes/practice-route.tsx`)
- In `PracticeRoute` and `PracticeScreen`:
  Accept `actionItemId` from search parameters.
  When `actionItemId` is present, render a return banner/link to `/curriculum` ("Return to curriculum assessment").

### 5. Automated Tests
- `apps/web/src/routes/curriculum-route.test.tsx`:
  Test that pending action items render the practice calculation link pointing to `/practice` with `kind`, `group`, and `actionItemId`.
- `apps/web/src/routes/practice-route.test.tsx`:
  Test that when `/practice` is mounted with `actionItemId`, the return link to `/curriculum` is rendered.
- Full test suite execution across web and unit suites.

## Plan Checklist

- [ ] Task 1: Expose groupKey in ActionItemList schema and API handler
- [ ] Task 2: Validate actionItemId in practice router search
- [ ] Task 3: Add practice calculation drills link to CurriculumCard
- [ ] Task 4: Add return link to PracticeScreen when actionItemId is present
- [ ] Task 5: Full suite verification, story status update, and PR
