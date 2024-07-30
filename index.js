#!/usr/bin/env node

const simpleGit = require('simple-git');
const { select, confirm } = require('@inquirer/prompts');
const { ExitPromptError } = require('@inquirer/core');
const chalk = require('chalk');

const git = simpleGit();

async function isGitRepo() {
    try {
        await git.status();
        return true;
    } catch (err) {
        console.log(chalk.red('Not a Git repository.'));
        return false;
    }
}

async function getTags() {
    try {
        await git.fetch(['--tags']);
        const tags = await git.tags();
        return tags.all;
    } catch (err) {
        console.error(chalk.red('Error fetching tags.'));
        process.exit(1);
    }
}

function filterVersionTags(tags) {
    return tags.filter(tag => /^v\d+\.\d+/.test(tag));
}

function filterNonRootTags(tags) {
    const rootTag = getRootTag(tags);
    return rootTag ? tags.filter(tag => tag !== rootTag) : tags;
}

function getRootTag(tags) {
    return tags.find(tag => /^v\d+/.test(tag));
}

async function getLatestCommitHash() {
    try {
        const commitHash = await git.raw(['rev-parse', 'HEAD']);
        return commitHash.trim();
    } catch (err) {
        console.error(chalk.red('Error retrieving latest commit hash.'));
        process.exit(1);
    }
}

async function getCommitOfTag(tag) {
    try {
        const commitHash = await git.raw(['rev-parse', tag]);
        return commitHash.trim();
    } catch (err) {
        console.error(chalk.red('Error retrieving commit hash for tag.'));
        process.exit(1);
    }
}

function shortenCommitHash(commitHash) {
    return commitHash.substring(0, 7); // Shorten to the first 7 characters
}

async function deleteLocalTag(tag) {
    try {
        await git.tag(['-d', tag]);
        console.log(chalk.green(`Local tag ${tag} deleted.`));
    } catch (err) {
        console.error(chalk.red('Error deleting local tag.'));
        process.exit(1);
    }
}

async function forcePushTag(tag) {
    try {
        await git.raw(['push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`, '--force']);
        console.log(chalk.green(`Tag ${tag} force-pushed to GitHub.`));
    } catch (err) {
        console.error(chalk.red('Error force-pushing tag.'));
        process.exit(1);
    }
}

async function updateTag(tag, commitHash) {
    const oldCommitHash = await getCommitOfTag(tag);
    const shortOldCommitHash = shortenCommitHash(oldCommitHash);
    const shortNewCommitHash = shortenCommitHash(commitHash);

    console.log(chalk.green(`Updating tag ${tag} to point to commit ${shortNewCommitHash}`));
    try {
        // Delete the existing tag locally
        await deleteLocalTag(tag);
        // Create the new tag at the desired commit
        await git.tag([tag, commitHash]);
        // Force push the tag to the remote repository
        await forcePushTag(tag);
        console.log(chalk.green(`Tag ${tag} updated from ${shortOldCommitHash} to ${shortNewCommitHash}`));
        return { tag, oldCommitHash, newCommitHash: commitHash };
    } catch (err) {
        console.error(chalk.red('Error updating tag.'));
        console.error(err);
        process.exit(1);
    }
}

async function updateRootTag(rootTag, commitHash) {
    const oldCommitHash = await getCommitOfTag(rootTag);
    const shortOldCommitHash = shortenCommitHash(oldCommitHash);
    const shortNewCommitHash = shortenCommitHash(commitHash);

    console.log(chalk.green(`Updating root tag ${rootTag} to point to commit ${shortNewCommitHash}`));
    try {
        // Delete the existing root tag locally
        await deleteLocalTag(rootTag);
        // Create the new root tag at the desired commit
        await git.tag([rootTag, commitHash]);
        // Force push the root tag to the remote repository
        await forcePushTag(rootTag);
        console.log(chalk.green(`Root tag ${rootTag} updated from ${shortOldCommitHash} to ${shortNewCommitHash}`));
        return { tag: rootTag, oldCommitHash, newCommitHash: commitHash };
    } catch (err) {
        console.error(chalk.red('Error updating root tag.'));
        console.error(err);
        process.exit(1);
    }
}

async function main() {
    const changes = [];
    try {
        if (!(await isGitRepo())) return;

        const action = await select({
            message: 'What would you like to do?',
            choices: [
                { name: 'Update a Tag', value: 'update' },
                { name: 'Bump a Root Tag', value: 'bump' }
            ],
            result(name) {
                return name;
            }
        });

        if (action === 'update') {
            const tags = await getTags();
            const nonRootTags = filterNonRootTags(tags);

            if (nonRootTags.length === 0) {
                console.log(chalk.yellow('No tags available for update.'));
                process.exit(1);
            }

            const selectedTag = await select({
                message: 'Select a tag to update:',
                choices: nonRootTags.map(tag => ({ name: tag, value: tag })),
                result(name) {
                    return name;
                }
            });

            if (!selectedTag) {
                console.log(chalk.red('Selected tag is undefined or null.'));
                process.exit(1);
            }

            const latestCommitHash = await getLatestCommitHash();
            const shortCommitHash = shortenCommitHash(latestCommitHash);

            const confirmed = await confirm({
                message: `Do you want to update tag ${selectedTag} to point to the latest commit (${shortCommitHash})?`,
                default: true
            });

            if (confirmed) {
                const rootTag = getRootTag(tags);
                if (rootTag) {
                    const rootTagCommitHash = await getCommitOfTag(rootTag);
                    const selectedTagCommitHash = await getCommitOfTag(selectedTag);

                    if (rootTagCommitHash === selectedTagCommitHash) {
                        const updatedTag = await updateTag(selectedTag, latestCommitHash);
                        changes.push(updatedTag);

                        console.log(chalk.green(`Tag ${selectedTag} was updated. Found a matching root tag ${rootTag}.`));

                        const updateRootTagConfirmed = await confirm({
                            message: `Do you also want to update the root tag to point to the updated ${selectedTag} (${shortCommitHash})?`,
                            default: true
                        });

                        if (updateRootTagConfirmed) {
                            const updatedRootTag = await updateRootTag(rootTag, latestCommitHash);
                            changes.push(updatedRootTag); // Include root tag update in changes
                        } else {
                            console.log(chalk.yellow('Root tag update skipped.'));
                        }
                    } else {
                        const updatedTag = await updateTag(selectedTag, latestCommitHash);
                        changes.push(updatedTag);
                    }
                } else {
                    const updatedTag = await updateTag(selectedTag, latestCommitHash);
                    changes.push(updatedTag);
                }
            } else {
                console.log(chalk.yellow('Tag update canceled.'));
            }
        } else if (action === 'bump') {
            const tags = await getTags();
            const versionTags = filterVersionTags(tags);

            if (versionTags.length === 0) {
                console.log(chalk.yellow('No version tags found.'));
                process.exit(1);
            }

            const selectedTag = await select({
                message: 'Select a version tag to bump the root tag to:',
                choices: versionTags.map(tag => ({ name: tag, value: tag })),
                result(name) {
                    return name;
                }
            });

            if (!selectedTag) {
                console.log(chalk.red('Selected tag is undefined or null.'));
                process.exit(1);
            }

            const rootTag = getRootTag(tags);
            if (!rootTag) {
                console.log(chalk.yellow('No root tag found. Exiting.'));
                process.exit(1);
            }

            const commitHash = await getCommitOfTag(selectedTag);
            const shortCommitHash = shortenCommitHash(commitHash);

            const confirmed = await confirm({
                message: `Do you want to bump root tag ${rootTag} to point to the commit of tag ${selectedTag} (${shortCommitHash})?`,
                default: true
            });

            if (confirmed) {
                const updatedRootTag = await updateRootTag(rootTag, commitHash);
                changes.push(updatedRootTag); // Include root tag update in changes
            } else {
                console.log(chalk.yellow('Root tag update canceled.'));
            }
        } else {
            console.log(chalk.red('Invalid action selected.'));
            process.exit(1);
        }

        // Print the summary of changes only once
        if (changes.length > 0) {
            console.log(chalk.magenta('Summary of changes:'));
            changes.forEach(change => {
                console.log(chalk.magenta(`Tag ${change.tag}: ${shortenCommitHash(change.oldCommitHash)} -> ${shortenCommitHash(change.newCommitHash)}`));
            });
        }
    } catch (err) {
        if (err instanceof ExitPromptError) {
            console.log(chalk.yellow('Canceled by User'));
        } else {
            console.error(chalk.red('An unexpected error occurred.'));
            console.error(err);
        }
        process.exit(1);
    }
}

main();
