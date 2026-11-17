# 1. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

This project makes many decisions that affect its architecture, data, money handling, and security, such as the auth mechanism, the migration tool, and rounding rules for donations. Months later, the code shows *what* was chosen but not *why*, or which alternatives were rejected. The project is also a portfolio piece, so the owner needs to explain the reasoning behind each decision in interviews.

## Decision

We record every significant decision as an Architecture Decision Record (ADR) in `docs/decisions/`, using Michael Nygard's format:

- **Title**, numbered sequentially (`NNNN-short-title.md`)
- **Status**: Proposed, Accepted, Deprecated, or Superseded by ADR N
- **Context**: the problem and the forces involved
- **Decision**: what we chose, including the options we considered
- **Consequences**: what gets easier, what gets harder, and the follow-up work

An ADR is never edited to reverse its decision. A new ADR supersedes it, so the history stays intact.

## Consequences

- Decisions and their trade-offs are written down where the code lives, and they are reviewed in the same pull request as the change.
- Writing an ADR adds a few minutes per decision. That is a small cost next to re-deriving the reasoning later.
- The README's "Design decisions" section links to every ADR.
