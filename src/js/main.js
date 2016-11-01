/*
TODO/FEATURES

font size base 60 tall 20 - 120
end cap style?
word wrap + word wrap distance

alignment? left right ... center?
auto update on change?
*/



var FONTS_PATH="fonts/";
var FONT_PATHS=["sutton.js", "nassau.js", "kosciuszko.js"];
var FONT_DATA=[];

var CURRENT_FONT_ID=0;

var specimen = "ABCDEFGHIJ\n"+
				"KLMNOPQRS\n"+
				"TUVWXYZ\n"+
				"abcdefghij\n"+
				"klmnopqrs\n"+
				"tuvwxyz\n"+
				"0123456789\n"+
				"~!?.,<>:;'\"\n"+
				"[]{}\\/|+=-*_-";

//UI
/**************************************/
$( "#export" ).click(function() {
  exportSVG();
});
$( "#build" ).click(function() {
  buildText();
});

$( "#font-select" ).change(function() {
  	CURRENT_FONT_ID = $( this ).val();
  	resetRenderSettings();
});

$( "#font-scale" ).change(function() {
  $( "#font-scale" ).val( clamp( $( "#font-scale" ).val(), .333, 2) );
});

function getRenderSettings(){
	//get the render settings from the form
	var settings={
		strokeWeight: Number($( '#stroke-weight' ).val()),
		fontSize: Number($( '#font-scale' ).val()),
		wordWrap: $( '#word-wrap-toggle' ).prop('checked'),
		wordWrapWidth: Number($( '#word-wrap-width' ).val()),
		letterSpacing: Number($( '#letter-spacing' ).val()),
		lineHeight: Number($( '#line-height' ).val()),
		monospace: $( '#monospace' ).prop('checked'),
		spacingBase: Number($( '#spacing-base' ).val()),
	};
	return settings;
}

function resetRenderSettings(){
	//this is called when the font is changed
	//use the default settings from the font file
	var font = FONT_DATA[CURRENT_FONT_ID];
	$( '#letter-spacing' ).val(font.baseLetterSpacing);
	$( '#line-height' ).val(font.baseLineHeight);
	$( '#monospace' ).prop('checked', font.monospaced);
	$( '#spacing-base' ).val(font.baseLetterSpaceUnit);
}

//DRAWING FONTS
/**************************************/
function renderType(stringText){
	var renderSettings=getRenderSettings();
	var margin = 10;
	var xPos=margin;
	var yPos=margin;
	
	var wordGroup;
	var scale = clamp(renderSettings.fontSize, .33, 2);
	for(var i=0; i<stringText.length; i++){
		if(stringText[i] == " "){
			if(monospace){
				xPos += renderSettings.letterSpacing;
			}else{
				xPos += renderSettings.letterSpacing + (fontSpacingBase*2);
			}
			wordGroup = null;

			if(renderSettings.wordWrap && xPos > renderSettings.wordWrapWidth/scale){
				xPos = margin;
				yPos += renderSettings.lineHeight;
			}
		}else if(stringText[i] == "\n"){

			xPos = margin;
			yPos += renderSettings.lineHeight;
			wordGroup = null;
		}else if(stringText[i] == "\t"){
			//tab is equal to 4 spaces?
			if(monospace){
				xPos += renderSettings.letterSpacing*4;
			}else{
				xPos += (renderSettings.letterSpacing*4) + (fontSpacingBase*2);
			}
			wordGroup = null;

		}else{
			if(wordGroup==null){
				wordGroup = new Group();
			}
			

			var charLayer = getCharacterGroup(stringText[i]);
			if(charLayer==null){
				console.log("Error character not found: " + stringText[i]);
				continue;
			}
			var offset = charLayer.bounds.center;
			var copy = charLayer.clone();
			copy.visible=true;
			copy.strokeWidth = renderSettings.strokeWeight;
			wordGroup.addChild(copy);

			if(renderSettings.monospace){
				copy.position = new Point(xPos + offset.x, yPos + offset.y);
				xPos += renderSettings.letterSpacing;
			}else{
				var sideBearing = getCharSideBearing(stringText[i]);
				//add the left side bearing
				xPos += sideBearing[0] * renderSettings.spacingBase;
				//position the letter
				copy.position = new Point(xPos + offset.x, yPos + offset.y);
				//add the width of the letter
				xPos += copy.bounds.width;
				//add the right side bearing
				xPos += sideBearing[1] * renderSettings.spacingBase;
			}
		}
	}
	//scale the type
	
	project.activeLayer.scale(scale, new Point(0, 0));
}

function clamp(val, min, max){
	if(val<min) return min;
	if(val>max) return max;
	return val;
}

function getCharacterGroup(character){
	var charData = characterMap[character];
	if(charData==null){
		console.log("Error Character Not Mapped: " + character);
		return null;
	}
	return FONT_DATA[CURRENT_FONT_ID].paperSymbols.children['char-' + charData.name];
}

function getCharSideBearing(_char){
    //return side bearing values
    var fontLetterSpacing = FONT_DATA[CURRENT_FONT_ID].charLetterSpacing;

    if(fontLetterSpacing[_char] && fontLetterSpacing[_char].sidebearing){
        return fontLetterSpacing[_char].sidebearing;
    }

    // $.writeln("No spacing info found: " + _char);
    return [0,0];
}

function reset(){
	project.clear();
}

function buildText(){
	reset();
	renderType($('#text-field').val());
}

//LOADING & SAVING
/**************************************/
function loadFontData(id){
	//if (typeof someObject == 'undefined') 
	$.loadScript(FONTS_PATH + FONT_PATHS[id], function(){	
		console.log('font data loaded');
		FONT_DATA[id] = data;
		loadFontSVG(id);
	});
}

function loadFontSVG(id){
	//get the font file param
	var options={
		onLoad:function(item){
			console.log('svg loaded');
			FONT_DATA[id].paperSymbols = item;
		},
		insert:false,
		expandShapes:true,
	};
	paper.project.importSVG(FONTS_PATH + FONT_DATA[id].file, options);
}

function exportSVG(fileName){
	paper.project.exportSVG();


   if(!fileName) {
       fileName = "gf_000.svg"
   }

   var url = "data:image/svg+xml;utf8," + encodeURIComponent(paper.project.exportSVG({asString:true}));

   var link = document.createElement("a");
   link.download = fileName;
   link.href = url;
   link.click();
}

//UTILS
/**************************************/
jQuery.loadScript = function (url, callback) {
    jQuery.ajax({
        url: url,
        dataType: 'script',
        success: callback,
        async: true
    });
}

//SETUP + INIT
/**************************************/
function init(){
	//load in the fonts
	loadFontData(0);
	loadFontData(1);
	loadFontData(2);
	//specimen
	$('#text-field').val(specimen);
}

//wait until everything is loaded
function initRun(){
	// console.log('go', FONT_DATA[0].paperSymbols);
	reset();
	resetRenderSettings();
	buildText();
}

init();
setTimeout(initRun, 1000);

var characterMap = {
    "a":{name:"a", layer:null},
    "b":{name:"b", layer:null},
    "c":{name:"c", layer:null},
    "d":{name:"d", layer:null},
    "e":{name:"e", layer:null},
    "f":{name:"f", layer:null},
    "g":{name:"g", layer:null},
    "h":{name:"h", layer:null},
    "i":{name:"i", layer:null},
    "j":{name:"j", layer:null},
    "k":{name:"k", layer:null},
    "l":{name:"l", layer:null},
    "m":{name:"m", layer:null},
    "n":{name:"n", layer:null},
    "o":{name:"o", layer:null},
    "p":{name:"p", layer:null},
    "q":{name:"q", layer:null},
    "r":{name:"r", layer:null},
    "s":{name:"s", layer:null},
    "t":{name:"t", layer:null},
    "u":{name:"u", layer:null},
    "v":{name:"v", layer:null},
    "w":{name:"w", layer:null},
    "x":{name:"x", layer:null},
    "y":{name:"y", layer:null},
    "z":{name:"z", layer:null},
    "A":{name:"A", layer:null},
    "B":{name:"B", layer:null},
    "C":{name:"C", layer:null},
    "D":{name:"D", layer:null},
    "E":{name:"E", layer:null},
    "F":{name:"F", layer:null},
    "G":{name:"G", layer:null},
    "H":{name:"H", layer:null},
    "I":{name:"I", layer:null},
    "J":{name:"J", layer:null},
    "K":{name:"K", layer:null},
    "L":{name:"L", layer:null},
    "M":{name:"M", layer:null},
    "N":{name:"N", layer:null},
    "O":{name:"O", layer:null},
    "P":{name:"P", layer:null},
    "Q":{name:"Q", layer:null},
    "R":{name:"R", layer:null},
    "S":{name:"S", layer:null},
    "T":{name:"T", layer:null},
    "U":{name:"U", layer:null},
    "V":{name:"V", layer:null},
    "W":{name:"W", layer:null},
    "X":{name:"X", layer:null},
    "Y":{name:"Y", layer:null},
    "Z":{name:"Z", layer:null},
    "0":{name:"0", layer:null},
    "1":{name:"1", layer:null},
    "2":{name:"2", layer:null},
    "3":{name:"3", layer:null},
    "4":{name:"4", layer:null},
    "5":{name:"5", layer:null},
    "6":{name:"6", layer:null},
    "7":{name:"7", layer:null},
    "8":{name:"8", layer:null},
    "9":{name:"9", layer:null},
    "-":{name:"dash", layer:null},
    "—":{name:"dash", layer:null},
    "_":{name:"underscore", layer:null},
    '"':{name:"doublequote", layer:null},
    "“":{name:"doublequote", layer:null},
    "”":{name:"doublequote", layer:null},
    "'":{name:"quote", layer:null},
    "’":{name:"quote", layer:null},
    ",":{name:"comma", layer:null},
    "~":{name:"tilde", layer:null},
    ":":{name:"colon", layer:null},
    ";":{name:"semicolon", layer:null},
    "?":{name:"question", layer:null},
    ".":{name:"period", layer:null},
    "!":{name:"exclamation", layer:null},
    "&":{name:"ampersand", layer:null},
    "#":{name:"pound", layer:null},
    "|":{name:"bar", layer:null},
    "\\":{name:"backslash", layer:null},
    "/":{name:"slash", layer:null},
    ")":{name:"parenthright", layer:null},
    "(":{name:"parenthleft", layer:null},
    "%":{name:"percent", layer:null},
    ">":{name:"greaterthan", layer:null},
    "<":{name:"lessthan", layer:null},
    "}":{name:"curlyright", layer:null},
    "{":{name:"curlyleft", layer:null},
    "]":{name:"bracketright", layer:null},
    "[":{name:"bracketleft", layer:null},
    "^":{name:"caret", layer:null},
    "@":{name:"at", layer:null},
    "$":{name:"dollar", layer:null},
    "=":{name:"equal", layer:null},
    "+":{name:"plus", layer:null},
    "*":{name:"asterix", layer:null}
}