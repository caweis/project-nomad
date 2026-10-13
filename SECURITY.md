# Security policy

## Report a vulnerability

Please use the [private vulnerability reporting form](https://github.com/caweis/project-nomad/security/advisories/new) for a security issue in this fork. Include the affected version or commit, host operating system, steps to reproduce, and the impact you observed. Keep exploit details out of public issues and Discord while the report is being reviewed.

Reports about the current code are welcome. If you found an issue on an older installation, update and retest when you can. There is no guaranteed response time or bug bounty.

## Deployment boundary

The Command Center has no login. Anyone who can reach it on the local network can use its administration features. Run NOMAD on a network you trust, restrict access at the network layer if needed, and do not expose the Command Center directly to the internet. The lack of a login by itself is an intentional design choice. Please still report path traversal, injection, unintended access beyond NOMAD's data, or other concrete security effects, including ones that start from local-network access.

If the problem is in a third-party Supply Depot application, report it to that application's maintainers. Report it here too when NOMAD's packaging or configuration contributes to the problem.

If you find a credential committed to this repository, use the private form so it can be investigated without publishing it first.
