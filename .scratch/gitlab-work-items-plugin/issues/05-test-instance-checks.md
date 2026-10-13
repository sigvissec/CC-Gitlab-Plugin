# What does our test Instance actually support?

Type: task
Status: claimed
Blocked by: 01

## Question

HITL. The user runs a checklist by hand against their test Instance (no Premium) and reports back: GitLab version, tier, gitlab.com or self-managed, which Work Item Types are enabled, whether the GraphQL Work Items queries and mutations from [What can GitLab's Work Items API do, and where is it gated?](01-gitlab-work-items-api.md) work there, and how a PAT with the needed scopes is created. The checklist is written from the API research findings, so this waits on them.

## Checklist

Written from [What can GitLab's Work Items API do, and where is it gated?](01-gitlab-work-items-api.md). Use a throwaway project you can delete afterwards. Run the GraphQL in your Instance's GraphQL explorer at `<base URL>/-/graphql-explorer` (it runs as you, no token needed), except where a step says curl. Replace `<…>` placeholders with real values, and copy any error text exactly.

1. **Instance basics.** The plugin's minimum is GitLab 18.1, so flag it right away if the version is older. Record the base URL (including any sub-path), whether it's gitlab.com or self-managed, and the tier (self-managed: Admin area > Subscription; gitlab.com: the top-level group's plan). Run:
   ```graphql
   query { metadata { version enterprise } }
   ```
2. **Token.** Create a personal access token (User settings > Access tokens) with the `api` scope and a short expiry. Check both header styles, since plugin settings may only be able to send `Bearer`:
   ```sh
   curl -s -H "PRIVATE-TOKEN: <token>" -H "Content-Type: application/json" -d '{"query":"query { currentUser { username } }"}' <base URL>/api/graphql
   curl -s -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"query":"query { currentUser { username } }"}' <base URL>/api/graphql
   ```
3. **Work Item Types.** Record each `id` and `name`:
   ```graphql
   query { namespace(fullPath: "<group/project>") { workItemTypes { nodes { id name } } } }
   ```
4. **Read an Issue.** Create an Issue in the UI with a Comment, then:
   ```graphql
   query { namespace(fullPath: "<group/project>") { workItem(iid: "<iid>") {
     id iid title state webUrl workItemType { name }
     userPermissions { updateWorkItem }
     widgets { type
       ... on WorkItemWidgetHierarchy { parent { id } children { nodes { id title } } }
       ... on WorkItemWidgetLinkedItems { linkedItems { nodes { linkType workItem { id title } } } }
       ... on WorkItemWidgetNotes { discussions(filter: ONLY_COMMENTS) { nodes { id replyId resolvable resolved notes { nodes { id body } } } } }
     } } } }
   ```
   Note which widget `type`s come back.
4b. **List Work Items.** Copy the result or error exactly:
   ```graphql
   query { project(fullPath: "<group/project>") { workItems(first: 5, state: opened) { nodes { iid title workItemType { name } } pageInfo { hasNextPage endCursor } } } }
   ```
5. **Create a Task under the Issue** (Task type ID from step 3, Issue `id` from step 4):
   ```graphql
   mutation { workItemCreate(input: { namespacePath: "<group/project>", workItemTypeId: "<Task type id>", title: "Checklist task", hierarchyWidget: { parentId: "<Issue id>" } }) { workItem { id iid webUrl } errors } }
   ```
6. **Edit the Task.** Then re-read it in the UI and say whether each change stuck:
   ```graphql
   mutation { workItemUpdate(input: { id: "<Task id>", title: "Checklist task (edited)", descriptionWidget: { description: "Edited by the checklist" }, startAndDueDateWidget: { dueDate: "2026-12-31" } }) { workItem { id title } errors } }
   ```
   Then close it with `stateEvent: CLOSE` in the same mutation shape.
7. **Thread, reply, resolve.**
   ```graphql
   mutation { createDiscussion(input: { noteableId: "<Issue id>", body: "Checklist thread" }) { note { id discussion { id replyId } } errors } }
   ```
   ```graphql
   mutation { createNote(input: { noteableId: "<Issue id>", discussionId: "<replyId>", body: "Checklist reply" }) { note { id } errors } }
   ```
   ```graphql
   mutation { discussionToggleResolve(input: { id: "<discussion id>", resolve: true }) { discussion { resolved } errors } }
   ```
8. **Linked Item.** Create a second Issue, then:
   ```graphql
   mutation { workItemAddLinkedItems(input: { id: "<Issue id>", workItemsIds: ["<second Issue id>"], linkType: RELATED }) { errors } }
   ```
9. **Expected failures on a non-Premium tier.** Copy the exact error text for each:
   - `workItemUpdate` on the Task with `weightWidget: { weight: 3 }`.
   - `workItemCreate` with the Epic type ID and a group `namespacePath`.
10. **GitLab's own MCP server.** Record the HTTP status of `curl -si <base URL>/api/v4/mcp | head -1`.
11. **glab, if installed.** Record the output of `glab version` and `glab auth status --hostname <host>`. Don't use `--show-token`.

Delete the token and the throwaway project when done, and paste the results (or a summary of them) back into the session.
