const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const {loadCommonJSModule} = require('./helpers')

const libPath = path.resolve(__dirname, '..', 'lib.js')

function loadLib({
    core = {},
    childProcess = {},
    fs = {},
    pathModule = path,
    processObject = process,
} = {}) {
    return loadCommonJSModule(libPath, {
        globals: {process: processObject},
        requireOverrides: {
            '@actions/core': core,
            child_process: childProcess,
            fs,
            path: pathModule,
            process: processObject,
        },
    })
}

test('version helpers convert Visual Studio year and version strings', () => {
    const lib = loadLib()

    assert.equal(lib.vsversion_to_versionnumber('2026'), '18.0')
    assert.equal(lib.vsversion_to_versionnumber('2022'), '17.0')
    assert.equal(lib.vsversion_to_versionnumber('17.0'), '17.0')
    assert.equal(lib.vsversion_to_versionnumber('custom'), 'custom')

    assert.equal(lib.vsversion_to_year('18.0'), '2026')
    assert.equal(lib.vsversion_to_year('17.0'), '2022')
    assert.equal(lib.vsversion_to_year('2022'), '2022')
    assert.equal(lib.vsversion_to_year('custom'), 'custom')
})

test('findWithVswhere returns a matching path when vswhere succeeds', () => {
    const warnings = []
    const lib = loadLib({
        core: {
            warning(message) {
                warnings.push(message)
            },
        },
        childProcess: {
            execSync(command) {
                assert.match(command, /-version "17\.0,17\.9"/)
                return Buffer.from('C:\\VS\\Preview\n')
            },
        },
    })

    assert.equal(
        lib.findWithVswhere('VC\\Auxiliary\\Build\\vcvarsall.bat', '-version "17.0,17.9"'),
        'C:\\VS\\Preview\\VC\\Auxiliary\\Build\\vcvarsall.bat'
    )
    assert.deepEqual(warnings, [])
})

test('findWithVswhere warns and returns null when vswhere fails', () => {
    const warnings = []
    const lib = loadLib({
        core: {
            warning(message) {
                warnings.push(message)
            },
        },
        childProcess: {
            execSync() {
                throw new Error('vswhere missing')
            },
        },
    })

    assert.equal(lib.findWithVswhere('pattern', '-latest'), null)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /vswhere failed:/)
})

test('findVcvarsall prefers the vswhere result when the file exists', () => {
    let vswhereCommand
    const infos = []
    const lib = loadLib({
        core: {
            info(message) {
                infos.push(message)
            },
            warning() {},
        },
        childProcess: {
            execSync(command) {
                vswhereCommand = command
                return Buffer.from('C:\\VS\\2022\n')
            },
        },
        fs: {
            existsSync(candidate) {
                return candidate === 'C:\\VS\\2022\\VC\\Auxiliary\\Build\\vcvarsall.bat'
            },
        },
        processObject: {
            env: {
                'ProgramFiles(x86)': 'C:\\PF86',
                ProgramFiles: 'C:\\PF',
            },
            platform: 'win32',
        },
    })

    assert.equal(lib.findVcvarsall('2022'), 'C:\\VS\\2022\\VC\\Auxiliary\\Build\\vcvarsall.bat')
    assert.match(vswhereCommand, /-version "\[17\.0,18\.0\)"/)
    assert.ok(infos.some((message) => message.includes('Found with vswhere')))
})

test('findVcvarsall queries the VS 2026 version range when requested', () => {
    let vswhereCommand
    const lib = loadLib({
        core: {
            info() {},
            warning() {},
        },
        childProcess: {
            execSync(command) {
                vswhereCommand = command
                return Buffer.from('C:\\VS\\2026\n')
            },
        },
        fs: {
            existsSync(candidate) {
                return candidate === 'C:\\VS\\2026\\VC\\Auxiliary\\Build\\vcvarsall.bat'
            },
        },
        processObject: {
            env: {
                'ProgramFiles(x86)': 'C:\\PF86',
                ProgramFiles: 'C:\\PF',
            },
            platform: 'win32',
        },
    })

    assert.equal(lib.findVcvarsall('2026'), 'C:\\VS\\2026\\VC\\Auxiliary\\Build\\vcvarsall.bat')
    assert.match(vswhereCommand, /-version "\[18\.0,19\.0\)"/)
})

test('findVcvarsall uses an exclusive upper bound so point releases like .9 are still in range', () => {
    // Visual Studio 2026 shipped as installationVersion 18.9.12112.369. The
    // previous "major.9" upper bound (e.g. "18.0,18.9") treated ".9" as
    // "18.9.0.0" and excluded any point release whose own version already
    // reached .9, which is exactly what happened here.
    let vswhereCommand
    const lib = loadLib({
        core: {
            info() {},
            warning() {},
        },
        childProcess: {
            execSync(command) {
                vswhereCommand = command
                return Buffer.from('C:\\VS\\2026\n')
            },
        },
        fs: {
            existsSync(candidate) {
                return candidate === 'C:\\VS\\2026\\VC\\Auxiliary\\Build\\vcvarsall.bat'
            },
        },
        processObject: {
            env: {
                'ProgramFiles(x86)': 'C:\\PF86',
                ProgramFiles: 'C:\\PF',
            },
            platform: 'win32',
        },
    })

    lib.findVcvarsall('2026')
    assert.doesNotMatch(vswhereCommand, /-version "18\.0,18\.9"/)
    assert.match(vswhereCommand, /-version "\[18\.0,19\.0\)"/)
})

test('findVcvarsall falls back to standard installation locations', () => {
    const triedPaths = []
    const standardPath = 'D:\\PF\\Microsoft Visual Studio\\2019\\Community\\VC\\Auxiliary\\Build\\vcvarsall.bat'
    const lib = loadLib({
        core: {
            info() {},
            warning() {},
        },
        childProcess: {
            execSync() {
                return Buffer.from('C:\\Missing\n')
            },
        },
        fs: {
            existsSync(candidate) {
                triedPaths.push(candidate)
                return candidate === standardPath
            },
        },
        processObject: {
            env: {
                'ProgramFiles(x86)': 'C:\\PF86',
                ProgramFiles: 'D:\\PF',
            },
            platform: 'win32',
        },
    })

    assert.equal(lib.findVcvarsall('2019'), standardPath)
    assert.ok(triedPaths.includes(standardPath))
})

test('findVcvarsall throws when no Visual Studio installation can be found', () => {
    const infos = []
    const lib = loadLib({
        core: {
            info(message) {
                infos.push(message)
            },
            warning() {},
        },
        childProcess: {
            execSync() {
                throw new Error('vswhere missing')
            },
        },
        fs: {
            existsSync() {
                return false
            },
        },
        processObject: {
            env: {
                'ProgramFiles(x86)': 'C:\\PF86',
                ProgramFiles: 'C:\\PF',
            },
            platform: 'win32',
        },
    })

    assert.throws(() => lib.findVcvarsall(), /Microsoft Visual Studio not found/)
    assert.ok(infos.some((message) => message.includes('No Visual Studio installations were found at all')))
})

test('findVcvarsall logs other installed versions it found when the requested version is missing', () => {
    const infos = []
    const lib = loadLib({
        core: {
            info(message) {
                infos.push(message)
            },
            warning() {},
        },
        childProcess: {
            execSync(command) {
                // The version-scoped vswhere query (used to look for the
                // requested version) finds nothing, because the installed
                // instance's version falls outside the "18.0,18.9" bound ...
                if (command.includes('-version')) {
                    return Buffer.from('\n')
                }
                // ... but the version-less diagnostic query finds it's
                // actually installed under a version-numbered directory
                // rather than a year-named one.
                return Buffer.from(JSON.stringify([
                    {installationPath: 'C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise', installationVersion: '19.0.1234.56'},
                ]))
            },
        },
        fs: {
            existsSync() {
                return false
            },
        },
        processObject: {
            env: {
                'ProgramFiles(x86)': 'C:\\PF86',
                ProgramFiles: 'C:\\PF',
            },
            platform: 'win32',
        },
    })

    assert.throws(() => lib.findVcvarsall('2026'), /Microsoft Visual Studio not found/)
    assert.ok(infos.some((message) => message.includes('Could not find Visual Studio 2026, but found these installations instead:')))
    assert.ok(infos.some((message) => message.includes('vswhere: 19.0.1234.56 at C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise')))
})

test('findAllVersions reports installations found via vswhere and standard locations', () => {
    const lib = loadLib({
        core: {warning() {}},
        childProcess: {
            execSync(command) {
                assert.match(command, /^vswhere -products \* -prerelease -format json$/)
                return Buffer.from(JSON.stringify([
                    {installationPath: 'C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise', installationVersion: '19.0.1234.56'},
                    {installationPath: 'C:\\VS\\2019', installationVersion: '16.11.9.0'},
                ]))
            },
        },
        fs: {
            existsSync(candidate) {
                return candidate === 'C:\\PF86\\Microsoft Visual Studio\\2017\\Community\\VC\\Auxiliary\\Build\\vcvarsall.bat'
            },
        },
        processObject: {
            env: {
                'ProgramFiles(x86)': 'C:\\PF86',
                ProgramFiles: 'C:\\PF',
            },
            platform: 'win32',
        },
    })

    assert.deepEqual([...lib.findAllVersions()], [
        'vswhere: 19.0.1234.56 at C:\\Program Files\\Microsoft Visual Studio\\18\\Enterprise',
        'vswhere: 16.11.9.0 at C:\\VS\\2019',
        'standard location: C:\\PF86\\Microsoft Visual Studio\\2017\\Community\\VC\\Auxiliary\\Build\\vcvarsall.bat',
    ])
})

test('findAllVersions falls back to standard locations when vswhere fails', () => {
    const warnings = []
    const lib = loadLib({
        core: {
            warning(message) {
                warnings.push(message)
            },
        },
        childProcess: {
            execSync() {
                throw new Error('vswhere missing')
            },
        },
        fs: {
            existsSync(candidate) {
                return candidate === 'C:\\PF\\Microsoft Visual Studio\\2026\\BuildTools\\VC\\Auxiliary\\Build\\vcvarsall.bat'
            },
        },
        processObject: {
            env: {
                'ProgramFiles(x86)': 'C:\\PF86',
                ProgramFiles: 'C:\\PF',
            },
            platform: 'win32',
        },
    })

    assert.deepEqual([...lib.findAllVersions()], [
        'standard location: C:\\PF\\Microsoft Visual Studio\\2026\\BuildTools\\VC\\Auxiliary\\Build\\vcvarsall.bat',
    ])
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /vswhere failed:/)
})

test('findAllVersions returns an empty array when nothing is installed', () => {
    const lib = loadLib({
        core: {warning() {}},
        childProcess: {
            execSync() {
                return Buffer.from('[]')
            },
        },
        fs: {
            existsSync() {
                return false
            },
        },
        processObject: {
            env: {
                'ProgramFiles(x86)': 'C:\\PF86',
                ProgramFiles: 'C:\\PF',
            },
            platform: 'win32',
        },
    })

    assert.deepEqual([...lib.findAllVersions()], [])
})

test('setupMSVCDevCmd is a no-op on non-Windows runners', () => {
    const infos = []
    const lib = loadLib({
        core: {
            info(message) {
                infos.push(message)
            },
        },
        childProcess: {
            execSync() {
                throw new Error('should not run')
            },
        },
        processObject: {
            env: {PATH: '/usr/bin'},
            platform: 'linux',
        },
    })

    assert.doesNotThrow(() => lib.setupMSVCDevCmd('x64', '', '', '', '', ''))
    assert.deepEqual(infos, ['This is not a Windows virtual environment, bye!'])
})

test('setupMSVCDevCmd configures the environment and normalizes path-like variables', () => {
    const debugMessages = []
    const exported = []
    const grouped = []
    const infos = []
    const execCommands = []
    const processObject = {
        env: {
            PATH: 'C:\\Existing',
            'ProgramFiles(x86)': 'C:\\PF86',
            ProgramFiles: 'C:\\PF',
        },
        platform: 'win32',
    }
    const lib = loadLib({
        core: {
            debug(message) {
                debugMessages.push(message)
            },
            endGroup() {
                grouped.push('end')
            },
            exportVariable(name, value) {
                exported.push([name, value])
            },
            info(message) {
                infos.push(message)
            },
            startGroup(name) {
                grouped.push(name)
            },
            warning() {},
        },
        childProcess: {
            execSync(command, options) {
                execCommands.push([command, options])
                if (command.startsWith('vswhere ')) {
                    return Buffer.from('C:\\VS\\2022\n')
                }
                return Buffer.from(
                    [
                        'PATH=C:\\Old;C:\\Tools',
                        'INCLUDE=C:\\Include;C:\\Include',
                        'UNCHANGED=value',
                    ].join('\r\n') +
                    '\f' +
                    [
                        '**********************************************************************',
                        'Visual Studio developer prompt',
                    ].join('\r\n') +
                    '\f' +
                    [
                        'PATH=C:\\New;C:\\New;C:\\Tools',
                        'INCLUDE=C:\\Include;C:\\More;C:\\More',
                        'UNCHANGED=value',
                        'VSCMD_ARG_TGT_ARCH=x64',
                    ].join('\r\n')
                )
            },
        },
        fs: {
            existsSync(candidate) {
                return candidate === 'C:\\VS\\2022\\VC\\Auxiliary\\Build\\vcvarsall.bat'
            },
        },
        pathModule: {delimiter: ';'},
        processObject,
    })

    lib.setupMSVCDevCmd('Win64', '10.0.22621.0', '14.29', 'true', 'true', '2022')

    assert.equal(processObject.env.PATH, 'C:\\Existing;C:\\PF86\\Microsoft Visual Studio\\Installer')
    assert.match(
        debugMessages[0],
        /vcvars command-line: "C:\\VS\\2022\\VC\\Auxiliary\\Build\\vcvarsall\.bat" x64 uwp 10\.0\.22621\.0 -vcvars_ver=14\.29 -vcvars_spectre_libs=spectre/
    )
    assert.equal(
        execCommands[1][0],
        'set && cls && "C:\\VS\\2022\\VC\\Auxiliary\\Build\\vcvarsall.bat" x64 uwp 10.0.22621.0 -vcvars_ver=14.29 -vcvars_spectre_libs=spectre && cls && set'
    )
    assert.equal(execCommands[1][1].shell, 'cmd')
    assert.deepEqual(grouped, ['Environment variables', 'end'])
    assert.deepEqual(exported, [
        ['PATH', 'C:\\New;C:\\Tools'],
        ['INCLUDE', 'C:\\Include;C:\\More'],
        ['VSCMD_ARG_TGT_ARCH', 'x64'],
    ])
    assert.equal(infos.at(-1), 'Configured Developer Command Prompt')
})

test('setupMSVCDevCmd surfaces vcvarsall parameter errors from the batch output', () => {
    const lib = loadLib({
        core: {
            debug() {},
            endGroup() {},
            exportVariable() {},
            info() {},
            startGroup() {},
            warning() {},
        },
        childProcess: {
            execSync(command) {
                if (command.startsWith('vswhere ')) {
                    return Buffer.from('C:\\VS\\2022\n')
                }
                return Buffer.from(
                    ['PATH=C:\\Old'].join('\r\n') +
                    '\f' +
                    [
                        '[ERROR:VSDEVCMD0001] Error in script usage. The correct usage is:',
                        '[ERROR:VSDEVCMD0002] Invalid option provided',
                    ].join('\r\n') +
                    '\f' +
                    ['PATH=C:\\Old'].join('\r\n')
                )
            },
        },
        fs: {
            existsSync(candidate) {
                return candidate === 'C:\\VS\\2022\\VC\\Auxiliary\\Build\\vcvarsall.bat'
            },
        },
        pathModule: {delimiter: ';'},
        processObject: {
            env: {
                PATH: 'C:\\Existing',
                'ProgramFiles(x86)': 'C:\\PF86',
                ProgramFiles: 'C:\\PF',
            },
            platform: 'win32',
        },
    })

    assert.throws(
        () => lib.setupMSVCDevCmd('x64', '', '', '', '', '2022'),
        /invalid parameters\r\n\[ERROR:VSDEVCMD0002\] Invalid option provided/
    )
})
