# CI — CodeBuild buildspecs

Each file here is loaded **by path** from a CDK-defined CodeBuild project in
`infra/stacks/`. The path is stored in the deployed project, so if you move or
rename one of these, update the matching `BuildSpec.from_source_filename(...)`
and run `cdk deploy` — otherwise the next build fails with "buildspec not found".

| File | Pipeline | Defined in |
|------|----------|------------|
| `buildspec-build.yml` | Vercel web build | `infra/stacks/pipeline_stack.py` |
| `buildspec-deploy.yml` | Vercel deploy stage — runs against the *build artifact*, so this folder must stay a plain top-level directory that the artifact includes | `infra/stacks/pipeline_stack.py` |
| `buildspec-pricing.yml` | Pricing autopilot (schedule-triggered) | `infra/stacks/pricing_stack.py` |
