# Contributing

Hello there 👋. This contributing file is used amongst the matrix.org bridge repositories and should be followed when
making any contribution. If you are reading this, that means you are going to be contributing to some free software,
and that's great! Thank you!

## 🗨️ Getting in touch

As a Matrix-based project we use chat rooms heavily for coodinating work. When getting involved with an issue or pull
request, feel free to reach out to us in one of the project rooms. The project room for the repository you are working
on should be visible from the README.md file.

Be aware that by interacting with our Matrix rooms and/or GitHub repositories, you are agreeing to abide by the
[Matrix.org code of conduct](https://matrix.org/legal/code-of-conduct).


## ✍️ Filing issues

We use the GitHub issue tracker for issue filing. A good issue can mean the difference between a quick fix and a long,
painful fixing process. That's why the following guidelines exist:

- If you are reporting a bug:
  - Write a short title which neatly summaries the *problem*.
    Do **not** write the *solution* in the issue title.
    For example: `Cannot create a nick with | in it` is a good issue title. `Filter nicks according to RFC 2812`
    is not a good issue title.
  - Give a summary and as much information (along with proposed solutions) as possible in the description of the issue.
  - Please either mention which version of the bridge you are using, or the commit hash.
- If it's a feature:
  - Your title should be a quick summary such as "Add ability to send encrypted files"
  - Your description should describe the outcome, not the solution.
    - For instance: "A function exists which can be used to send encrypted files to Matrix rooms".
    - Not: "There should be a MatrixClient.sendEncryptedFile() so the Foobar bridge can send encrypted images"

Issues will be categorised according to [Synapse's rules](https://github.com/matrix-org/synapse/issues/9460). To summarise:

- Your issue will be catagorised as one of the following types by the maintainer team:
  - **T-Defect**: Bugs, crashes, hangs, vulnerabilities, or other reported problems.
  - **T-Enhancement**: New features, changes in functionality, performance boosts, user-facing improvements.
  - **T-Documentation**: Improvements or additions to documentation.
- You *may* have a severity assigned as an estimate to understand how bad the problem is and how many users are affected.

The assigned labels are at the maintainers' discretion, and we will make every effort to be transparent when triaging.
We do not, as a rule, assign priority labeling to issues.

## Contributing documentation

Documentation is important to us, as bridges are complex beasts and rely on good documentation for both
administrators and users. There are a couple of things to keep in mind when when writing documentation
for bridge projects:
 
 - Use [Plain English](https://en.wikipedia.org/wiki/Plain_English) when documenting. Assume a non-native speaker audience.
 - Please take care to proofread.
 - Documentation should be written for both end users of the bridge, as well as system administrators. It should always be
   made clear in the text which class of user you are targetting.

## Contributing code

First of all, thank you for considering making a change to one of our projects. Every change no matter the size makes a difference! 

### 🖌️ Code style

Each repository contains an `eslint` configuration which will dictate the style of the code. All code should be written in
TypeScript. At time of writing, we target ES2020 (the latest version supported by Node 14). The CI will lint your code automatically,
but you can save yourself some time by running (`yarn lint`/`npm lint`) to check locally.

### 🧪 Tests / CI

To test your changes, you can run the `test` command with either `yarn test` or `npm test`. Some projects may have additional
testing constraints noted in the project-specific section below.

Please be aware that reviewers will expect CI to be passing before your changes will be approved, and priority will be given to
PRs that pass CI when reviewing too. If you can't get the CI to pass, please reach out to us either via the PR or in the project
Matrix room (and do not assume that it's always your change that caused the test to fail!).

**As a rule, code does not get merged onto the `develop` branch without all CI tests passing.**

### Tips for good quality submissions

 - When writing new features, remember to document them in the repository's chosen documentation system.
 - PRs should aim to be as constrained as possible: Do not attempt to solve multiple isolated issues in a single PR.
   - A good indication is that your changelog entry contains multiple statements. That usually means you need to consider splitting up your PR :)
 - It's totally okay to submit draft PRs with the intention of getting feedback. Please use the GitHub comments feature to comment
  on lines you would like assistance with.
 - Avoid writing TODOs / XXX comments in code. If you must, create an issue first with the details and link to it in the code.


### ⬇️ Pull Requests

When making a pull request, please ensure it [the PR] follows these best practises:

- Targets `develop` (unless it explicitly depends upon another feature, then depend on that branch and comment to that effect in the PR body).
- Is updated via rebase mechanisms when `develop` changes, rather than merge commits (reduces noise).
- Is [signed off](https://matrix-org.github.io/synapse/latest/development/contributing_guide.html#sign-off). Matrix.org projects require that the
   sign off process has been followed in its entirety.
- Has a [changelog entry](https://matrix-org.github.io/synapse/latest/development/contributing_guide.html#changelog) in `changelog.d`.
  A changelog filename should be `${GithubPRNumber}.{bugfix|misc|feature|doc|removal}`.
  The change should include information that is useful to the user rather than the developer.
   
  You can choose to sign your changelog entry to be credited by appending something like "Thanks to @Half-Shot"
  at the end of the file, on the same line.

  You may be wondering how to determine your `GithubPRNumber` number ahead of time. [Synapse offers some useful
  hints](https://matrix-org.github.io/synapse/latest/development/contributing_guide.html#how-do-i-know-what-to-call-the-changelog-file-before-i-create-the-pr) for this.

- Is passing CI. As noted above, please feel free to call out any CI issues you cannot fix.
- Calls out any issue it may fix with a "Fixes #issue-no" in the body.


When PRs are merged, we will squash the commits down to a single commit. Because of this, do not be afraid to
make multiple commits to a branch rather than amending and force pushing existing commits.

We aim to review all PRs in a timely manner, though be aware that larger PRs will take more thought.


### ✔️ Review process

We aim to review all PRs from the community promptly, although we can't offer firm time commitments. If you think
your PR has been forgotten and it's been a while, do not hesistate to politely ping in the correct project room.

When reviewing a PR, a maintainer will:
 - Constructively call out areas for improvement. Code reviews are as much about learning as getting code good,
   so conversations always seek to improve *mutual* understanding.
 - Resolve a comment thread when they are satisifed. The author of the code may 👍 a review comment to say
   they have acknowledged the message and will make the change.
 - Approve a PR which is ready to merge, or nearly ready with some minor tweaks or optional improvements.


## 🏁 That's it!

This guide aims to cover all bases to get new contributors started, but it won't be able to satisfy every question. If
you have any other questions, please seek us out in any of the project rooms and we will be happy to assist! Other than that,
thanks for taking the time to read this and improving our projects for
the benefit of all 😄
