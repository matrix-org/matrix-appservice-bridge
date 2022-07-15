# Filing Issues
A good issue can mean the difference between a quick fix and a long, painful fixing process. That's why the
following guidelines exist:

 - Use the [Github issue tracker](https://github.com/matrix-org/matrix-appservice-bridge/issues) to file your issues.
 - Write a short title which neatly summaries the *problem*. Do **not** write the *solution* in the issue title.
   For example: `Cannot create a nick with | in it` is a good issue title. `Filter nicks according to RFC 2812`
   is not a good issue title.
 - Give a summary and as much information (along with proposed solutions) as possible in the body of the issue.
 - Include reproduction steps where possible.
 - Provide the commit SHA or version number of the `matrix-appservice-bridge` being used.

# Making Pull Requests
This project follows "git flow" semantics. In practice, this means:
 - The `master` branch is latest current stable release.
 - The `develop` branch is where all the new code ends up.
 - When forking the project, fork from `develop` and then write your code.
 - Make sure your new code passes all the code checks (tests and linting). Do this by running
   `yarn test && yarn lint`.
 - Create a pull request. If this PR fixes an issue, link to it by referring to its number.
 - PRs from community members must be signed off as per Synapse's [Sign off section](https://github.com/matrix-org/synapse/blob/master/CONTRIBUTING.md#sign-off)
 - Create a changelog entry in `changelog.d`. A changelog filename should be `${GithubPRNumber}.{bugfix|misc|feature|doc|removal}`
   The change should include information that is useful to the user rather than the developer.
   You can choose to sign your changelog entry to be credited by appending something like "Thanks to @Half-Shot"
   at the end of the file, on the same line.
