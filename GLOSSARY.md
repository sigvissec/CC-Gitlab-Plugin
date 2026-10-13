# GitLab Work Items Plugin

A Claude Code plugin that brings GitLab Work Items into the session, so Claude can work with them and change them without leaving it.

## GitLab

**Instance**:
A single GitLab deployment, either gitlab.com or a self-managed installation, identified by its base URL (which can include a sub-path).
_Avoid_: server, host (as a noun for the deployment)

**Work Item**:
A trackable unit of work in GitLab, of exactly one Work Item Type.
_Avoid_: issue (when meaning any type), ticket

**Work Item Type**:
The kind of a Work Item. Issue, Task, and Epic are supported; other types (objective, key result, incident, test case, requirement) are not.

**Issue**:
A Work Item of type Issue, living in a project.

**Task**:
A Work Item of type Task, usually the child of an Issue.

**Epic**:
A Work Item of type Epic, living in a group and parenting Issues or other Epics.

**Hierarchy**:
The parent/child relationships between Work Items.
_Avoid_: tree, nesting

**Linked Item**:
A non-hierarchical relationship between two Work Items, such as "relates to" or "blocks".
_Avoid_: dependency, relation

## Collaboration

**Comment**:
A single message posted on a Work Item.
_Avoid_: note

**Thread**:
A Comment together with its replies, which can be resolved as a unit.
_Avoid_: discussion

## Plugin actions

**Fetch**:
Reading one Work Item, or a filtered list of them, live from an Instance into the session.
_Avoid_: sync, pull, import

**Edit**:
A change to an existing Work Item's title, description, or fields (labels, assignees, milestone, state, weight, due date, parent).
_Avoid_: update, modify

## Working with Work Items

**Review**:
Claude's assessment of a Work Item's clarity, completeness, and gaps, made from its Fetched data when the user asks. It is something Claude does, not a plugin action.
_Avoid_: analysis, audit
