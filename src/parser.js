/* 
 * This file is part of OverPy (https://github.com/Zezombye/overpy).
 * Copyright (c) 2019 Zezombye.
 * 
 * This program is free software: you can redistribute it and/or modify  
 * it under the terms of the GNU General Public License as published by  
 * the Free Software Foundation, version 3.
 *
 * This program is distributed in the hope that it will be useful, but 
 * WITHOUT ANY WARRANTY; without even the implied warranty of 
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU 
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License 
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

"use strict";

class Ast {

    constructor(name, args, children, type) {
        if (!name) {
            error("Got no name for ast");
        }
        if (type === "NumberLiteral") {
            if (typeof name !== "number") {
                error("Expected a number for type NumberLiteral, but got '"+typeof name+"'");
            }
        } else if (typeof name !== "string") {
            error("Expected a string, but got '"+name+"'");
        }
        this.name = name;
        this.args = args ? args : [];
        this.children = children ? children : [];

        if (!type) {
            if (name in funcKw) {
                this.type = funcKw[name].return;
            } else {
                error("Unknown function name '"+name+"'");
            }
        } else {
            this.type = type;
        }

        for (var arg of this.args) {
            if (!(arg instanceof Ast)) {
                error("Arg '"+arg+"' of '"+name+"' is not an AST");
            }
            arg.parent = this;
        }
        for (var child of this.children) {
            if (!(child instanceof Ast)) {
                error("Child '"+child+"' of '"+name+"' is not an AST");
            }
            child.parent = this;
        }
        this.fileStack = fileStack;
        this.argIndex = 0;
        this.childIndex = 0;
    }
}

class WorkshopVar {
    constructor(name, index) {
        this.name = name;
        this.index = index === undefined ? null : index;
    }
}

class Rule {
    constructor() {
        this.name = null;
        this.conditions = [];
        this.actions = [];
        this.event = null;
        this.eventTeam = null;
        this.eventPlayer = null;
        this.isDisabled = false;
    }
}

function parseLines(lines) {

    //console.log("Lines to ast: "+JSON.stringify(lines, null, 4));
    var result = [];
    var currentComment = null;
    var ruleAttributes = {};
    
    for (var i = 0; i < lines.length; i++) {
        fileStack = lines[i].tokens[0].fileStack;
        
        if (lines[i].tokens[0].text.startsWith("#")) {
            currentComment = lines[i].tokens[0].text.substring(1);
            continue;
        }
        if (lines[i].tokens[0].text === "globalvar" || lines[i].tokens[0].text === "playervar" || lines[i].tokens[0].text === "subroutine") {
			if (lines[i].tokens.length < 2 || lines[i].tokens.length > 3) {
				error("Malformed "+lines[i].tokens[0].text+" declaration");
			}
			var index = lines[i].tokens.length > 2 ? lines[i].tokens[2].text : null

			if (lines[i].tokens[0].text === "globalvar") {
				addVariable(lines[i].tokens[1].text, true, index);
			} else if (lines[i].tokens[0].text === "playervar") {
				addVariable(lines[i].tokens[1].text, false, index);
			} else {
				addSubroutine(lines[i].tokens[1].text, index);
            }
            
        } else if (lines[i].tokens[0].text === "settings") {
            var customGameSettings = eval("("+dispTokens(lines[i].tokens.slice(1))+")");
            compileCustomGameSettings(customGameSettings);
        
        } else if (lines[i].tokens[0].text.startsWith("@")) {

            var annotation = lines[i].tokens[0].text;

            if (["@Name", "@Event", "@Team", "@Slot", "@Hero"].includes(annotation)) {
                const annotationToPropMap = {
                    "@Name": {prop: "name", display: "name"},
                    "@Event": {prop: "event", display: "event"},
                    "@Team": {prop: "eventTeam", display: "event team"},
                    "@Slot": {prop: "eventPlayer", display: "event player (@Hero/@Slot)"},
                    "@Hero": {prop: "eventPlayer", display: "event player (@Hero/@Slot)"},
                };

                if (lines[i].tokens.length !== 2) {
                    error("Malformed rule "+annotationToPropMap[annotation].display+" declaration (found "+lines[i].tokens.length+" tokens, expected 2)");
                }
                if (annotationToPropMap[annotation].prop in ruleAttributes) {
                    error("Rule "+annotationToPropMap[annotation].display+" was already declared");
                }

                if (annotation === "@Name") {
                    ruleAttributes[annotationToPropMap[annotation].prop] = unescapeString(lines[i].tokens[1].text);
                } else {
                    ruleAttributes[annotationToPropMap[annotation].prop] = lines[i].tokens[1].text;
                }
                
            } else if (annotation === "@SuppressWarnings") {
                if (lines[i].tokens.length === 1) {
                    error("Expected at least one token after @SuppressWarnings")
                }
                for (var token of lines[i].tokens) {
                    suppressedWarnings.push(token.text);
                }

            } else if (annotation === "@Disabled") {
                ruleAttributes.isDisabled = true;

            } else if (annotation === "@Condition") {
                if (!("conditions" in ruleAttributes)) {
                    ruleAttributes.conditions = [];
                }
                var parsedCondition = parse(lines[i].tokens.slice(1));
                ruleAttributes.conditions.push(parsedCondition);

            } else {
                error("Unknown annotation '"+annotation+"'");
            }

        } else if (["rule", "if", "elif", "else", "do", "for", "def", "while", "switch", "case"].includes(lines[i].tokens[0].text)) {

            var tokenToFuncMapping = {
                "rule": "__rule__",
                "if": "__if__",
                "elif": "__elif__",
                "else": "__else__",
                "do": "__doWhile__",
                "for": "__for__",
                "def": "__def__",
                "while": "__while__",
                "switch": "__switch__",
                "case": "__case__",
            }
            var funcName = tokenToFuncMapping[lines[i].tokens[0].text];
            var args = [];
            var children = [];
            var instructionRuleAttributes = undefined;
            var lineMembers = splitTokens(lines[i].tokens, ":", true);
            if (lineMembers.length === 1) {
                error("Expected a ':' at the end of the line");
            }
            //console.log(lineMembers);

            if (funcName === "__rule__" || funcName === "__def__") {
                if (funcName === "__rule__") {
                    if (ruleAttributes.name !== undefined) {
                        error("Cannot use the '@Name' annotation on a rule");
                    }
                    if (lineMembers[0].length !== 2) {
                        error("Malformatted 'rule' declaration");
                    }
                    ruleAttributes.name = unescapeString(lineMembers[0][1].text);

                } else {
                    if (lineMembers[0].length !== 4 || lineMembers[0][2].text !== "(" || lineMembers[0][3].text !== ")") {
                        error("Malformatted 'def' declaration");
                    }
                    ruleAttributes.subroutineName = lineMembers[0][1].text;
                }
                instructionRuleAttributes = ruleAttributes;
                ruleAttributes = {};
            }

            if (!["__else__", "__doWhile__", "__rule__", "__def__"].includes(funcName)) {
                args = [parse(lineMembers[0].slice(1))];
            }
            
            var currentLineIndent = lines[i].indentLevel;
            var childrenLines = [];
            if (lineMembers[1].length > 0) {
                childrenLines.append(new LogicalLine(currentLineIndent+1, lineMembers[1]));
            }
            
            //Get children lines
            var nextIndentLevel = null;
            var j = i+1;
            for (; j < lines.length; j++) {
                fileStack = lines[j].tokens[0].fileStack;

                //Ignore comments
                if (!lines[j].tokens[0][0] !== "#") {
                    if (lines[j].indentLevel <= currentLineIndent) {
                        break;
                    } else if (lines[j].indentLevel > currentLineIndent && nextIndentLevel !== null && lines[j].indentLevel < nextIndentLevel) {
                        error("Indentation does not match any outer indentation level");
                    }
                }
                if (nextIndentLevel = null) {
                    nextIndentLevel = lines[j].indentLevel;
                    if (childrenLines.length > 0) {
                        childrenLines[0].indentLevel = nextIndentLevel;
                    }
                }
                childrenLines.push(lines[j]);
            }

            if (funcName === "__doWhile__") {
                //There should be a "while" matching the "do"
                if (j < lines.length && lines[j].tokens[0].text === "while") {
                    args = [parse(lines[j].tokens.slice(1))];
                    j++;
                } else {
                    error("Found 'do', but no matching 'while'");
                }
            }

            i += j-i-1;
            children = parseLines(childrenLines);

            var instruction = new Ast(funcName, args, children);
            instruction.comment = currentComment;
            instruction.ruleAttributes = instructionRuleAttributes;
            
            result.push(instruction);
    
        } else {
            var currentLineAst = parse(lines[i].tokens);
            currentLineAst.comment = currentComment;
            result.push(currentLineAst);
        }
        currentComment = null;
    }
    
    //console.log(result);
    return result;
}

function parse(content) {

	if (content === undefined) {
		error("Content is undefined");
	} else if (content.length === 0) {
		error("Content is empty (missing operand or argument?)");
    }
    
    fileStack = content[0].fileStack;
	debug("Parsing '"+dispTokens(content)+"'");
    
    //Parse operators, according to the operator precedence in pyOperators.
    for (var operator of pyOperators) {
		
		if (operator === "not" || operator === "if") {
			var operands = splitTokens(content, operator, false, false);
		} else {
			var operands = splitTokens(content, operator, false, true);
		}
		if (operands.length === 2) {
			
			//The operator is present; parse it
			if (operator === "=") {
                return new Ast("__assignTo__", [parse(operands[0]), parse(operands[1])]);
                
			} else if (operator === "if") {
                //"true if condition else false"
				
				var trueExpr = parse(operands[0]);
				var elseOperands = splitTokens(operands[1], "else", false, false);
				if (elseOperands.length !== 2) {
					error("Found 'if', but no 'else'");
				}
				var falseExpr = parse(elseOperands[1]);
				var condition = parse(elseOperands[0]);

                return new Ast("__ifElse__", [condition, trueExpr, falseExpr]);

			} else if (["or", "and"].includes(operator)) {

				var op1 = parse(operands[0]);
                var op2 = parse(operands[1]);
                return new Ast("__"+operator+"__", [op1, op2]);

			} else if (operator === "not") {

				var op1 = parse(operands[1]);
                return new Ast("__not__", [op1]);

			} else if (operator === "in") {
                
                var value = parse(operands[0]);
                var array = parse(operands[1]);
                return new Ast("__arrayContains__", [array, value]);

			} else if (["==", "!=", "<=", ">=", "<", ">"].includes(operator)) {

				var op1 = parse(operands[0]);
                var op2 = parse(operands[1]);
                var opToFuncMapping = {
                    "==": "__equals__",
                    "!=": "__inequals__",
                    "<=": "__lessThanOrEquals__",
                    ">=": "__greaterThanOrEquals__",
                    "<": "__lessThan__",
                    ">": "__greaterThan__",
                }
                return new Ast(opToFuncMapping[operator], [op1, op2]);

			} else if (["+=", "-=", "*=", "/=", "%=", "**=", "min=", "max="].includes(operator)) {
                //Actually de-optimize so we can keep the logic in one place.
                //Transform "A += 1" to "A = A + 1".

                var opToFuncMapping = {
                    "+=": "__add__",
                    "-=": "__subtract__",
                    "*=": "__multiply__",
                    "/=": "__divide__",
                    "%=": "__modulo__",
                    "**=": "__raiseToPower__",
                    "min=": "__min__",
                    "max=": "__max__",
                };

                var variable = parse(operands[0]);
                var value = parse(operands[1]);
                return new Ast("__assignTo__", [variable, new Ast(opToFuncMapping[operator], [variable, value])]);

			} else if (["++", "--"].includes(operator)) {
                //De-optimise as well: A++ -> A = A + 1.
                var opToFuncMapping = {
                    "++": "__add__",
                    "--": "__subtract__",
                };
                var op1 = parse(operands[0]);

                //Check if there is something after the operator. If yes, treat it like an operation.
                //Eg: "A -- B" = "A ++ B" = "A + B"
                if (operands[1].length > 0) {
                    var op2 = parse(operands[1]);
                    return new Ast("__add__", [op1, op2]);

                } else {
                    return new Ast("__assignTo__", [op1, new Ast(opToFuncMapping[operator], [op1, getAstFor1()])])
                }

			} else if (["/", "*", "%", "**"].includes(operator)) {

                var opToFuncMapping = {
                    "/": "__divide__",
                    "*": "__multiply__",
                    "%": "__modulo__",
                    "**": "__raiseToPower__",
                }
				var op1 = parse(operands[0]);
                var op2 = parse(operands[1]);
                return new Ast(opToFuncMapping[operator], [op1, op2]);

			} else if (operator === "-") {
				
                //Handle things like "3*-5" by checking if the 1st operand ends by another operator
                //Note: we only need to check operators with an equal or higher precedence than "-"
				if (operands[0].length > 0 && ["-", "*", "/", "%", "**"].includes(operands[0][operands[0].length-1].text)) {
					continue;
				}

                var op2 = parse(operands[1]);
                if (operands[0].length === 0) {
                    return new Ast("__negate__", [op2]);

                } else {
                    var op1 = operands[0].length === 0 ? new Ast("-1") : parse(operands[0]);
                    return new Ast("__subtract__", [op1, op2]);
                }


			} else if (operator === "+") {

                //Handle things like "3*+5" by checking if the 1st operand ends by another operator
                //Note: we only need to check operators with an equal or higher precedence than "+"
				if (operands[0].length > 0 && ["+", "-", "*", "/", "%", "**"].includes(operands[0][operands[0].length-1].text)) {
					continue;
                }
                
                var op2 = parse(operands[1]);
                if (operands[0].length === 0) {
                    return op2;
                } else {

                    var op1 = operands[0].length === 0 ? "0" : parse(operands[0]);
                    return new Ast("__add__", [op1, op2]);
                }

			} else {
				error("Unhandled operator "+operator);
			}
			
			break;
		}
    }
    		
	//Parse array
	if (content[content.length-1].text === ']') {
		var bracketPos = getTokenBracketPos(content);
		
		if (bracketPos.length === 2 && bracketPos[0] === 0) {
            //It is a literal array such as [1,2,3] or [i for i in A if x].
            return parseLiteralArray(content);
            
		} else {
            var array = parse(content.slice(0, bracketPos[bracketPos.length-2]));
            var value = parse(content.slice(bracketPos[bracketPos.length-2]+1, content.length-1))
            return new Ast("__valueInArray__", [array, value])
		}
	}

	//Parse dictionary
	if (content[0].text === "{") {
		return parseDictionary(content);
	}
	
	//Check for parentheses
	if (content[0].text === '(') {
		var bracketPos = getTokenBracketPos(content);
		if (bracketPos.length === 2 && bracketPos[1] === content.length-1) {
            //All the expression is in parentheses; just remove them
            return parse(content.slice(1, content.length-1));

        } else {
            error("Malformatted parentheses");
        }
	}
	
	//Check for "." operator, which has the highest precedence.
	//It must be parsed from right to left.
	var operands = splitTokens(content, ".", false, true);
	if (operands.length === 2) {
		return parseMember(operands[0], operands[1]);
	}

	//Check for strings
	if (content[content.length-1].text.startsWith('"') || content[content.length-1].text.startsWith("'")) {
		var stringType = "StringLiteral";
		var string = "";
		for (var i = content.length-1; i >= 0; i--) {
			if (content[i].text.startsWith('"') || content[i].text.startsWith("'")) {
				string = unescapeString(content[i].text)+string;

			} else {
				if (i === 0) {
					//string modifier?
					if (content[0].text === "l") {
						stringType = "LocalizedStringLiteral";
					} else if (content[0].text === "b") {
						stringType = "BigLettersStringLiteral";
					} else if (content[0].text === "w") {
						stringType = "FullwidthStringLiteral";
					} else {
						error("Invalid string modifier '"+content[0].text+"', valid ones are 'l' (localized), 'b' (big letters) and 'w' (fullwidth)");
					}
				} else {
					error("Expected string, but got '"+content[i].text+"'");
				}
			}
        }
        
        return new Ast(string, [], [], stringType);
	}
	
	//Parse args and name of function.
	var name = content[0].text;
	var args = null;
	if (content.length > 1) {
		if (content[1].text === '(') {
			args = splitTokens(content.slice(2, content.length-1), ",");
		} else {
			error("Syntax error: expected '(' after '"+name+"', but got '"+content[1].text+"'");
		}
	}

	if (args === null) {

		//Check for current array element variable name
		if (currentArrayElementNames.indexOf(name) >= 0) {
			return new Ast("__currentArrayElement__");
        }
        
        //Check for global variable
        if (isVarName(name, true)) {
            return new Ast("__globalVar__", [new Ast(name, [], [], "GlobalVariable")]);
        }

        //Check for number
        if (isNumber(name)) {
            //It is an int, else it would have a dot, and wouldn't be processed here.
            //It is also an unsigned int, as the negative sign is not part of the name.
            return new Ast("__number__", [new Ast(Number(name), [], [], "NumberLiteral")], [], "unsigned int");
        }

		return new Ast(name);
    }
    
	debug("args: "+args.map(x => "'"+dispTokens(x)+"'").join(", "));
	
	//Special functions

	if (name === "async") {
		if (args.length != 2) {
			error("Function 'async' takes 2 arguments, received "+args.length);
		}
        //Check if first arg is indeed a subroutine
        var subroutineArg = args[0][0].text;
		if (!isSubroutineName(subroutineArg)) {
			error("Expected subroutine name as first argument");
        }
        
        return new Ast("__startRule__", [new Ast(subroutineArg, [], [], "Subroutine"), parse(args[1])])
	}
		
	if (name === "chase") {
		
		if (args.length !== 4) {
			error("Function 'chase' takes 4 arguments, received "+args.length);
        }
        if ((args[2][0].text !== "rate" && args[2][0].text !== "duration") || args[2][1].text !== "=") {
			error("3rd argument of function 'chase' must be 'rate = xxxx' or 'duration = xxxx'");
        }
        
        if (args[3].length !== 3 || args[3][0].text !== "ChaseReeval" || args[3][1].text !== ".") {
            error("Expected a member of the 'ChaseReeval' enum as 4th argument for function 'chase', but got '"+dispTokens(args[3])+"'");
        }
        if (args[2][0].text === "rate") {
            var funcName = "__chaseAtRate__";
            args[3][0].text = "__ChaseRateReeval__";
        } else {
            var funcName = "__chaseOverTime__";
            args[3][0].text = "__ChaseTimeReeval__";
        }

        return new Ast(funcName, [parse(args[0]), parse(args[1]), parse(args[2].slice(2)), parse(args[3])]);
	}
	
	if (name === "raycast") {

        if (args.length === 5) {
			if (args[2].length >= 2 && args[2][0].text === "include" || args[2][1].text === "=") {
				args[2] = args[2].slice(2);
            } 
            if (args[3].length >= 2 && args[3][0].text === "exclude" || args[3][1].text === "=") {
				args[3] = args[3].slice(2);
            } 
            if (args[4].length >= 2 && args[4][0].text === "includePlayerObjects" || args[4][1].text === "=") {
				args[4] = args[4].slice(2);
            }

            return new Ast("__raycast__", [parse(args[0]), parse(args[1]), parse(args[2]), parse(args[3]), parse(args[4])], [], "Raycast");
            
        } else {
			error("Function 'raycast' takes 5 arguments, received "+args.length);
        }
	}
	
	if (name === "sorted") {
		if (args.length === 2) {
            var lambdaArgs = splitTokens(args[1], ':');
            if (lambdaArgs.length !== 2) {
                error("Syntax for sorted array condition is 'lambda x: condition(x)'");
            }
            if (lambdaArgs[0].length < 2) {
                error("Expected 'lambda x' before ':'");
            }
            if (lambdaArgs[0][0].text === "key" && lambdaArgs[0][1].text === "=") {
                lambdaArgs[0] = lambdaArgs[0].slice(2);
            }
            if (lambdaArgs[0][0].text !== "lambda") {
                error("Expected 'lambda x' before ':'");
            }
            if (lambdaArgs[0].length !== 2) {
                error("Expected a single token after 'lambda'");
            }
            
            currentArrayElementNames.push(lambdaArgs[0][1].text);
            var sortedCondition = parse(lambdaArgs[1]);
            currentArrayElementNames.pop();

        } else if (args.length !== 1) {
            error("Function 'sorted' takes 1 or 2 arguments, received "+args.length);
        }
        var astArgs = [parse(args[0])];
        if (args.length === 2) {
            astArgs.push(sortedCondition);
        }
        return new Ast("sorted", astArgs);
    }
		
	//Check for subroutine call
	if (args.length === 0) {
        if (isSubroutineName(name)) {
            return new Ast("__callSubroutine__", [new Ast(name, [], [], "Subroutine")]);
        }
    }
    
    return new Ast(name, args.map(x => parse(x)));
}

function parseMember(object, member) {

	debug("Parsing member '"+dispTokens(member)+"' of object '"+dispTokens(object)+"'");
	
	var name = member[0].text;
	//debug("name = "+name);
	var args = null;
	if (member.length > 1) {
		if (member[1].text === '(') {
            if (member[member.length-1].text !== ")") {
                fileStack = member[member.length-1].fileStack;
                error("Unexpected token '"+member[member.length-1].text+"'");
            }
			args = splitTokens(member.slice(2, member.length-1), ",");
		} else {
			error("Expected '(' after '"+name+"', but got '"+member[1].text+"'");
		}
	}

	if (args === null) {
		if (["x", "y", "z"].includes(name)) {
            return new Ast(`__${name}ComponentOf__`, [parse(object)]);
		}
        
        if (object.length === 1) {

            //Check enums
            if (Object.keys(constantValues).includes(object[0].text)) {

                var result = tows(object[0].text+"."+name, constantKw);
                if (object[0].text === "Hero") {
                    return new Ast("__hero__", [new Ast(name, [], [], "HeroLiteral")])

                } else if (object[0].text === "Map") {
                    return new Ast("__map__", [new Ast(name, [], [], "MapLiteral")])

                } else if (object[0].text === "Gamemode") {
                    return new Ast("__gamemode__", [new Ast(name, [], [], "GamemodeLiteral")])

                } else if (object[0].text === "Team") {
                    return new Ast("__team__", [new Ast(name, [], [], "TeamLiteral")])

                } else {
                    return new Ast(name, [], [], object[0].text);
                }

            //Check the pseudo-enum "math"
            } else if (object[0].text === "math") {
                if (name === "pi") {
                    return new Ast("3.14159265359");
                } else if (name === "e") {
                    return new Ast("2.71828182846");
                } else {
                    error("Unhandled member 'math."+name+"'");
                }
        
            //Check the pseudo-enum "Vector"
            } else if (object[0].text === "Vector") {
                return new Ast("Vector."+name);

            //Check for number
            } else if (isNumber(object[0].text)) {
                if (!isNumber(name)) {
                    error("Expected a number after '.' but got '"+name+"'");
                }
                return new Ast("__number__", [new Ast(object[0].text+"."+name, [], [], "NumberLiteral")], [], "unsigned float");

            } else {
                //Should be a player variable.
                if (!isVarName(name, false)) {
                    error("Unknown member '"+name+"'");
                }
                return new Ast("__playerVar__", [parse(object), new Ast(name, [], [], "PlayerVariable")]);
            }
        } else {
            error("Invalid object '"+object+"' for member '"+member+"'");
        }
	} else {
	
		if (["append", "exclude", "index", "remove"].includes(name)) {
            if (args.length !== 1) {
                error("Function '"+name+"' takes 1 argument, received "+args.length);
            }
            var funcToInternalFuncMap = {
                "append": "__appendToArray__",
                "exclude": "__removeFromArray__",
                "index": "__indexOfArrayValue__",
                "remove": "__removeFromArrayByValue__",
            };

            return new Ast("__"+funcToInternalFuncMap[name]+"__", [parse(object), parse(args[0])])
			
		} else if (name === "exclude") {
            if (args.length !== 1) {
                error("Function 'exclude' takes 1 argument, received "+args.length);
            }
			return new Ast("__removeFromArray__", [parse(object), parse(args[0])])
			
		} else if (name === "format") {
            return new Ast("__format__", [parse(object)].concat(args.map(x => parse(x))));
			
		} else if ("getHitPosition", "getNormal", "getPlayerHit", "hasLoS".includes(name)) {
            if (args.length !== 0) {
                error("Function '"+name+"' takes no argument, received "+args.length);
            }
            return new Ast("__"+name+"__", [parse(object)]);
			
		} else if (object[0].text === "random" && object.length === 1) {
			if (name === "randint" || name === "uniform") {
                if (args.length !== 2) {
                    error("Function 'random."+name+"' takes 2 arguments, received "+args.length);
                }
                return new Ast("random."+name, [parse(args[0]), parse(args[1])]);
                
			} else if (name === "shuffle" || name === "choice") {
                if (args.length !== 1) {
                    error("Function 'random."+name+"' takes 1 argument, received "+args.length);
                }
                return new Ast("random."+name, [parse(args[0])]);
                
			} else {
				error("Unhandled member 'random."+name+"'");
			}
			
		} else if (name === "slice") {
            if (args.length !== 2) {
                error("Function 'slice' takes 2 arguments, received "+args.length);
            }
			return new Ast("__arraySlice__", [parse(object), parse(args[0]), parse(args[1])]);
			
		} else {
            //Assume it is a player function
            return new Ast("_&"+name, [parse(object)].concat(args.map(x => parse(x))));
		}
	}
	
	error("This shouldn't happen");
}

//Parses a literal array such as [1,2,3] or [i for i in x if cond].
function parseLiteralArray(content) {
		
	if (content.length === 2) {
        return new Ast("__emptyArray__");
    }

    //Check for "in" keyword
    var inOperands = splitTokens(content.slice(1, content.length-1), "in", false);
    if (inOperands.length === 2) {

        var ifOperands = splitTokens(inOperands[1], "if");

        if (ifOperands.length !== 2) {
            //Expect something like "[x == y for x in z]"
            //Parse as the pseudo "map" function. Used for the "any"/"all" functions.
            //And well, maybe they will eventually add a map function...

            if (inOperands[0].length < 3 || inOperands[0][inOperands.length-2].text !== "for") {
                error("Malformed '[x for y in z]'")
            }
            currentArrayElementNames.push(inOperands[0][inOperands[0].length-1].text);
            var mappingFunction = parse(inOperands[0].slice(0, inOperands[0].length-2));
            currentArrayElementNames.pop();

            return new Ast("__mappedArray__", [parse(inOperands[1]), mappingFunction]);
            
        } else {
            //Filtered array
            if (inOperands[0].length !== 3 || inOperands[0][1].text !== "for" || inOperands[0][0].text !== inOperands[0][2].text) {
                error("Malformed 'x for x in y'");
            }
            debug("Parsing 'x for x in y if z', x='"+inOperands[0][0].text+"', y='"+ifOperands[0]+"', z='"+ifOperands[1]+"'");
            
            currentArrayElementNames.push(inOperands[0][0].text);
            var condition = parse(ifOperands[1]);
            currentArrayElementNames.pop();

            return new Ast("__filteredArray__", [parse(ifOperands[0]), condition]);
        }
    } else {
        
        //Literal array with only values ([1,2,3])
        var args = splitTokens(content.slice(1, content.length-1), ",");
        //Allow trailing comma
        if (args[args.length-1].length === 0) {
            args.pop()
        }

        return new Ast("__array__", args.map(x => parse(x)));
    }
	
	error("This shouldn't happen");
	
}