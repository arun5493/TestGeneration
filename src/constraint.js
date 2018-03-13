// Core/NPM Modules
const esprima = require("esprima");
const faker   = require("faker");
const fs      = require('fs');
const Random  = require('random-js');
const _       = require('lodash');
const randexp = require('randexp');



// Set options
faker.locale  = "en";
const options = { tokens: true, tolerant: true, loc: true, range: true };



// Create random generator engine
const engine = Random.engines.mt19937().autoSeed();


/**
 * Constraint class. Represents constraints on function call parameters.
 *
 * @property {String}                                                          ident      Identity of the parameter mapped to the constraint.
 * @property {String}                                                          expression Full expression string for a constraint.
 * @property {String}                                                          operator   Operator used in constraint.
 * @property {String|Number}                                                   value      Main constraint value.
 * @property {String|Number}                                                   altvalue   Constraint alternative value.
 * @property {String}                                                          funcName   Name of the function being constrained.
 * @property {'fileWithContent'|'fileExists'|'integer'|'string'|'phoneNumber'} kind       Type of the constraint.
 */
class Constraint {
    constructor(properties){
        this.ident = properties.ident;
        this.expression = properties.expression;
        this.operator = properties.operator;
        this.value = properties.value;
        this.altvalue = properties.altvalue;
        this.funcName = properties.funcName;
        this.kind = properties.kind;
    }
}


/**
 * Generate function parameter constraints for an input file
 * and save them to the global functionConstraints object.
 *
 * @param   {String} filePath Path of the file to generate tests for.
 * @returns {Object}          Function constraints object.
 */
function constraints(filePath) {

    // Initialize function constraints directory
    let functionConstraints = {};

    // Map Structure to hold the relation between variables and funcParams
    var variableMap = new Object();

    // Read input file and parse it with esprima.
    let buf = fs.readFileSync(filePath, "utf8");
    let result = esprima.parse(buf, options);

    // Start traversing the root node
    traverse(result, function (node) {


        // If some node is a function declaration, parse it for potential constraints.
        if (node.type === 'FunctionDeclaration') {

            // Get function name and arguments
            let funcName = functionName(node);
            let params = node.params.map(function(p) {return p.name});

            // Initialize function constraints
            functionConstraints[funcName] = {
                constraints: _.zipObject(params, _.map(params, () => [])),
                params: params
            };

            // Traverse function node.
            traverse(node, function(child) {

                // To keep track of variables declared through some function calls like .substring() or format()
                if( child.type == 'VariableDeclaration' && child.declarations[0].init.type == 'CallExpression') {
                  // For functions like format()
                  if(child.declarations[0].init.callee.type == 'Identifier') {
                    for(var i=0; i<child.declarations[0].init.arguments.length; i++) {
                      if (child.declarations[0].init.arguments[i].type == 'Identifier') {
                        variableMap[child.declarations[0].id.name] = child.declarations[0].init.arguments[i].name;
                      }
                    }
                  }
                  // for functions like area = num.substring(1,4)
                  if(child.declarations[0].init.callee.type == 'MemberExpression') {
                    variableMap[child.declarations[0].id.name] = child.declarations[0].init.callee.object.name;
                  }
                  // to get variable relation in buf = fs.readFileSync(filePath,"utf8"). This function will update 'buf' variable
                  if(child.declarations[0].init.callee.type == 'MemberExpression' && (child.declarations[0].init.arguments)) {
                    for(var i=0; i<child.declarations[0].init.arguments.length; i++) {
                      if (child.declarations[0].init.arguments[i].type == 'Identifier') {
                        variableMap[child.declarations[0].id.name] = child.declarations[0].init.arguments[i].name;
                      }
                    }
                  }
                }
                // Handle equivalence expression
                if(_.get(child, 'type') === 'BinaryExpression' && _.includes(['!=', '!==', '==', '==='], _.get(child, 'operator'))) {
                    if(_.get(child, 'left.type') === 'Identifier') {

                        // Get identifier
                        let ident = child.left.name;

                        // Get expression from original source code:
                        let expression = buf.substring(child.range[0], child.range[1]);
                        let rightHand = buf.substring(child.right.range[0], child.right.range[1]);

                        // Test to see if right hand is a string
                        let match = rightHand.match(/^['"](.*)['"]$/);

                        if (_.includes(params, _.get(child, 'left.name'))) {

                            // Push a new constraints
                            let constraints = functionConstraints[funcName].constraints[ident];
                            constraints.push(new Constraint({
                                ident: child.left.name,
                                value: rightHand,
                                funcName: funcName,
                                kind: "integer",
                                operator : child.operator,
                                expression: expression
                            }));
                            constraints.push(new Constraint({
                                ident: child.left.name,
                                value: match ? `'NEQ - ${match[1]}'` : NaN,
                                funcName: funcName,
                                kind: "integer",
                                operator : child.operator,
                                expression: expression
                            }));
                        }
                        else {
                          // This means the block contains a variable that is not in the function parameter
              						var key = child.left.name;
              						// To get the function parameter name that the variable depends on
              						while(variableMap[key]) {
              							key = variableMap[key];
              						}
                          ident = key;
              						// check whether `ident` is in params
              						if(_.includes(params, ident) && ident.toLowerCase().indexOf("phone") != -1) {
              							// get expression from original source code:
              							expression = buf.substring(child.range[0], child.range[1]);
              							rightHand = buf.substring(child.right.range[0], child.right.range[1]).replace(/['"]+/g, '');

              							var tempPhoneNum = faker.phone.phoneNumberFormat(1);
                            var phoneNum = '"' +tempPhoneNum.substring(0, 1) + rightHand + tempPhoneNum.substring(rightHand.length+1, tempPhoneNum.length) + '"';

                            functionConstraints[funcName].constraints[ident].push(new Constraint({
              									ident: ident,
              									value: phoneNum,
              									funcName: funcName,
              									kind: "phoneNumber",
              									operator : child.operator,
              									expression: expression
              								}));

              							var oppValue = '"' + tempPhoneNum.substring(0, 1) + (parseInt(rightHand) + 10) + tempPhoneNum.substring(rightHand.length+1, tempPhoneNum.length) + '"';

              							functionConstraints[funcName].constraints[ident].push(new Constraint({
              									ident: ident,
              									value: oppValue,
              									funcName: funcName,
              									kind: "phoneNumber",
              									operator : child.operator,
              									expression: expression
              								}));
              						}
                        }
                    }
                    // mode.indexOf("werw") == 0
                    if(_.get(child, 'left.callee.object.type') === 'Identifier') {

                        // Get identifier
                        let ident = child.left.callee.object.name;

                        // Get expression from original source code:
                        let expression = buf.substring(child.range[0], child.range[1]);
                        let rightHand = buf.substring(child.right.range[0], child.right.range[1]);
                        let argRaw = child.left.arguments[0].raw;
                        let argValue = child.left.arguments[0].value;

                        if (_.includes(params, _.get(child, 'left.callee.object.name'))) {
                            // Push a new constraints
                            let constraints = functionConstraints[funcName].constraints[ident];
                            constraints.push(new Constraint({
                                ident: child.left.callee.object.name,
                                value: argRaw,
                                funcName: funcName,
                                kind: 'string',
                                operator : child.operator,
                                expression: expression
                            }));
                            constraints.push(new Constraint({
                                ident: child.left.callee.object.name,
                                value: argValue,
                                funcName: funcName,
                                kind: 'string',
                                operator : child.operator,
                                expression: expression
                            }));
                        }
                    }
                }

                // Handle less than, greater than, greater than equal to, less than equal to expression
                if(_.get(child, 'type') === 'BinaryExpression' && _.includes(['<','>','<=','>='], _.get(child, 'operator'))) {
                    if(_.get(child, 'left.type') === 'Identifier') {

                        // Get identifier
                        let ident = child.left.name;

                        // Get expression from original source code:
                        let expression = buf.substring(child.range[0], child.range[1]);
                        let rightHand = buf.substring(child.right.range[0], child.right.range[1]);

                        if (_.includes(params, _.get(child, 'left.name'))) {

                            // Push a new constraints
                            let constraints = functionConstraints[funcName].constraints[ident];
                            constraints.push(new Constraint({
                                ident: child.left.name,
                                value: createConcreteIntegerValue(parseInt(rightHand),0),
                                funcName: funcName,
                                kind: 'integer',
                                operator : child.operator,
                                expression: expression
                            }));
                            constraints.push(new Constraint({
                                ident: child.right.name,
                                value: createConcreteIntegerValue(parseInt(rightHand),1),
                                funcName: funcName,
                                kind: 'integer',
                                operator : child.operator,
                                expression: expression
                            }));
                        }
                    }
                }

                // Handle fs.readFileSync
                if( child.type === "CallExpression" && child.callee.property && child.callee.property.name === "readFileSync" ) {
                    // Get expression from original source code:
                    let expression = buf.substring(child.range[0], child.range[1]);

                    for (let p in params) {
                        if( child.arguments[0].name === params[p] ) {

                            // Get identifier
                            let ident = params[p];

                            // Push a new constraint
                            functionConstraints[funcName].constraints[ident].push(new Constraint({
                                ident: params[p],
                                value:  "'pathContent/file1'",
                                funcName: funcName,
                                kind: "fileWithContent",
                            }));
                            functionConstraints[funcName].constraints[ident].push(new Constraint({
                                ident: params[p],
                                value:  "'file'", // Empty file - Check in testgenerator.js
                                funcName: funcName,
                                kind: "fileExists",
                            }));
                        }
                    }
                }

                // Handle existsSync expression
                if(_.get(child, 'type') === 'CallExpression' && !(child.operator) && child.callee.property && child.callee.property.name === "existsSync") {

                    // Get expression from original source code:
                    let expression = buf.substring(child.range[0], child.range[1]);
                    // let rightHand = buf.substring(child.right.range[0], child.right.range[1]);

                    for (let p in params) {
                        if( child.arguments[0].name === params[p] ) {
                            // Get identifier
                            let ident = params[p];

                            functionConstraints[funcName].constraints[ident].push(new Constraint({
                                ident: params[p],
                                value:  "'nonEmptyDir'",
                                funcName: funcName,
                                kind: "fileExists",
                                expression: expression
                            }));
                            functionConstraints[funcName].constraints[ident].push(new Constraint({
                                ident: params[p],
                                value:  "'emptyDir'",
                                funcName: funcName,
                                kind: "fileExists",
                                expression: expression
                            }));
                        }
                    }
                }

                // Handle Not operation expression
                if(_.get(child, 'type') === 'UnaryExpression' && _.includes(['!'], _.get(child, 'operator'))) {

                    // For !options.normalize
                    if(_.get(child, 'argument.type') === 'MemberExpression') {
                      // Get expression from original source code:
                      let expression = buf.substring(child.range[0], child.range[1]);

                      for (let p in params) {
                          if( child.argument.object.name === params[p] ) {

                              // Get identifier
                              let ident = params[p];

                              let prop = _.get(child,'argument.property.name');

                              var jsonObjTrue = {};
                              jsonObjTrue[prop] = true;
                              var jsonObjFalse = {};
                              jsonObjFalse[prop] = false;

                              var jsonObjTrueString = JSON.stringify(jsonObjTrue);
                              var jsonObjFalseString = JSON.stringify(jsonObjFalse);

                              functionConstraints[funcName].constraints[ident].push(new Constraint({
                                  ident: params[p],
                                  value: jsonObjTrueString,
                                  funcName: funcName,
                                  kind: "string",
                                  operator : child.operator,
                                  expression: expression
                              }));
                              functionConstraints[funcName].constraints[ident].push(new Constraint({
                                  ident: params[p],
                                  value: jsonObjFalseString,
                                  funcName: funcName,
                                  kind: "string",
                                  operator : child.operator,
                              }));
                          }
                      }
                    }
                }

            });

            console.log( functionConstraints[funcName]);
            
        }
    });

    return functionConstraints;
}

/**
 * Traverse an object tree, calling the visitor at each
 * visited node.
 *
 * @param {Object}   object  Esprima node object.
 * @param {Function} visitor Visitor called at each node.
 */
function traverse(object, visitor) {

    // Call the visitor on the object
    visitor(object);

    // Traverse all children of object
    for (let key in object) {
        if (object.hasOwnProperty(key)) {
            let child = object[key];
            if (typeof child === 'object' && child !== null) {
                traverse(child, visitor);
            }
        }
    }
}


/**
 * Return the name of a function node.
 */
function functionName(node) {
    return node.id ? node.id.name : '';
}


/**
 * Generates an integer value based on some constraint.
 *
 * @param   {Number}  constraintValue Constraint integer.
 * @param   {Boolean} greaterThan     Whether or not the concrete integer is greater than the constraint.
 * @returns {Number}                  Integer satisfying constraints.
 */
function createConcreteIntegerValue(constraintValue, greaterThan) {
    if( greaterThan ) return Random.integer(constraintValue + 1, constraintValue + 10)(engine);
    else return Random.integer(constraintValue - 10, constraintValue - 1)(engine);
}


// Export
module.exports = constraints;
