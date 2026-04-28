const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const {loadCommonJSModule} = require('./helpers')

const indexPath = path.resolve(__dirname, '..', 'index.js')

function runIndex({core, lib}) {
    loadCommonJSModule(indexPath, {
        requireOverrides: {
            '@actions/core': core,
            './lib': lib,
        },
    })
}

test('index entrypoint reads inputs and invokes setupMSVCDevCmd', () => {
    const requestedInputs = []
    const setupCalls = []

    runIndex({
        core: {
            getInput(name) {
                requestedInputs.push(name)
                return `${name}-value`
            },
            setFailed() {
                assert.fail('setFailed should not be called on success')
            },
        },
        lib: {
            setupMSVCDevCmd(...args) {
                setupCalls.push(args)
            },
        },
    })

    assert.deepEqual(requestedInputs, ['arch', 'sdk', 'toolset', 'uwp', 'spectre', 'vsversion'])
    assert.deepEqual(setupCalls, [[
        'arch-value',
        'sdk-value',
        'toolset-value',
        'uwp-value',
        'spectre-value',
        'vsversion-value',
    ]])
})

test('index entrypoint reports setup failures through core.setFailed', () => {
    const failures = []

    runIndex({
        core: {
            getInput(name) {
                return name === 'arch' ? 'x64' : ''
            },
            setFailed(message) {
                failures.push(message)
            },
        },
        lib: {
            setupMSVCDevCmd() {
                throw new Error('boom')
            },
        },
    })

    assert.deepEqual(failures, ['Could not setup Developer Command Prompt: boom'])
})
