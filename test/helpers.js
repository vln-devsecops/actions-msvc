const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const vm = require('node:vm')

function loadCommonJSModule(filename, {globals = {}, requireOverrides = {}} = {}) {
    const code = fs.readFileSync(filename, 'utf8')
    const module = {exports: {}}
    const dirname = path.dirname(filename)

    function customRequire(specifier) {
        if (Object.prototype.hasOwnProperty.call(requireOverrides, specifier)) {
            return requireOverrides[specifier]
        }
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
            return require(path.resolve(dirname, specifier))
        }
        return require(specifier)
    }

    const context = vm.createContext({
        Buffer,
        clearInterval,
        clearTimeout,
        console,
        exports: module.exports,
        module,
        setInterval,
        setTimeout,
        __dirname: dirname,
        __filename: filename,
        ...globals,
    })

    const wrapped = Module.wrap(code)
    const script = new vm.Script(wrapped, {filename})
    const compiled = script.runInContext(context)
    compiled(module.exports, customRequire, module, filename, dirname)
    return module.exports
}

module.exports = {loadCommonJSModule}
