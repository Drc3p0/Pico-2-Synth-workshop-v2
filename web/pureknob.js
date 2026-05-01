/*
 * pure-knob
 *
 * Canvas-based JavaScript UI element implementing touch,
 * keyboard, mouse and scroll wheel support.
 *
 * Copyright 2018 - 2021 Andre Plötze
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Vendored for Pico 2 Synth Workshop v2
 * Source: https://github.com/andrepxx/pure-knob
 */

"use strict";

(function (root, factory) {

	if ((typeof define === 'function') && define.amd) {
		define([], factory);
	} else if ((typeof module === 'object') && module.exports) {
		module.exports = factory();
	} else {
		root.pureknob = factory();
	}

} (typeof self !== 'undefined' ? self : this, function () {

	function PureKnob() {

		this.createBarGraph = function(width, height) {
			const heightString = height.toString();
			const widthString = width.toString();
			const canvas = document.createElement('canvas');
			const div = document.createElement('div');
			div.style.display = 'inline-block';
			div.style.height = heightString + 'px';
			div.style.position = 'relative';
			div.style.textAlign = 'center';
			div.style.width = widthString + 'px';
			div.appendChild(canvas);

			const graph = {
				'_canvas': canvas,
				'_div': div,
				'_height': height,
				'_width': width,
				'_properties': {
					'colorBG': '#181818',
					'colorFG': '#ff8800',
					'colorMarkers': '#888888',
					'markerStart': 0,
					'markerEnd': 100,
					'markerStep': 20,
					'trackWidth': 0.5,
					'valMin': 0,
					'valMax': 100,
					'valPeaks': [],
					'val': 0
				},
				'getPeaks': function() {
					const properties = this._properties;
					const peaks = properties.valPeaks;
					const numPeaks = peaks.length;
					const peaksCopy = [];
					for (let i = 0; i < numPeaks; i++) {
						peaksCopy.push(peaks[i]);
					}
					return peaksCopy;
				},
				'getProperty': function(key) {
					return this._properties[key];
				},
				'getValue': function() {
					return this._properties.val;
				},
				'node': function() {
					return this._div;
				},
				'redraw': function() {
					this.resize();
					const properties = this._properties;
					const colorTrack = properties.colorBG;
					const colorFilling = properties.colorFG;
					const colorMarkers = properties.colorMarkers;
					const markerStart = properties.markerStart;
					const markerEnd = properties.markerEnd;
					const markerStep = properties.markerStep;
					const trackWidth = properties.trackWidth;
					const valMin = properties.valMin;
					const valMax = properties.valMax;
					const peaks = properties.valPeaks;
					const value = properties.val;
					const height = this._height;
					const width = this._width;
					const lineWidth = Math.round(trackWidth * height);
					const halfWidth = 0.5 * lineWidth;
					const centerY = 0.5 * height;
					const lineTop = centerY - halfWidth;
					const lineBottom = centerY + halfWidth;
					const relativeValue = (value - valMin) / (valMax - valMin);
					const fillingEnd = width * relativeValue;
					const numPeaks = peaks.length;
					const canvas = this._canvas;
					const ctx = canvas.getContext('2d');
					ctx.clearRect(0, 0, width, height);
					if ((markerStart !== null) & (markerEnd !== null) & (markerStep !== null) & (markerStep !== 0)) {
						ctx.lineCap = 'butt';
						ctx.lineWidth = '2';
						ctx.strokeStyle = colorMarkers;
						for (let v = markerStart; v <= markerEnd; v += markerStep) {
							const relativePos = (v - valMin) / (valMax - valMin);
							const pos = Math.round(width * relativePos);
							ctx.beginPath();
							ctx.moveTo(pos, 0);
							ctx.lineTo(pos, height);
							ctx.stroke();
						}
					}
					ctx.beginPath();
					ctx.rect(0, lineTop, width, lineWidth);
					ctx.fillStyle = colorTrack;
					ctx.fill();
					ctx.beginPath();
					ctx.rect(0, lineTop, fillingEnd, lineWidth);
					ctx.fillStyle = colorFilling;
					ctx.fill();
					ctx.strokeStyle = colorFilling;
					for (let i = 0; i < numPeaks; i++) {
						const peak = peaks[i];
						const relativePeak = (peak - valMin) / (valMax - valMin);
						const pos = Math.round(width * relativePeak);
						ctx.beginPath();
						ctx.moveTo(pos, lineTop);
						ctx.lineTo(pos, lineBottom);
						ctx.stroke();
					}
				},
				'resize': function() {
					const canvas = this._canvas;
					const ctx = canvas.getContext('2d');
					const scale = window.devicePixelRatio;
					canvas.style.height = this._height + 'px';
					canvas.style.width = this._width + 'px';
					canvas.height = Math.floor(this._height * scale);
					canvas.width = Math.floor(this._width * scale);
					ctx.scale(scale, scale);
				},
				'setPeaks': function(peaks) {
					const peaksCopy = [];
					for (let i = 0; i < peaks.length; i++) {
						peaksCopy.push(peaks[i]);
					}
					this.setProperty('valPeaks', peaksCopy);
				},
				'setProperty': function(key, value) {
					this._properties[key] = value;
					this.redraw();
				},
				'setValue': function(value) {
					const properties = this._properties;
					const valMin = properties.valMin;
					const valMax = properties.valMax;
					if (value < valMin) { value = valMin; }
					else if (value > valMax) { value = valMax; }
					value = Math.round(value);
					this.setProperty('val', value);
				}
			};

			const resizeListener = function(e) { graph.redraw(); };
			const updatePixelRatio = function() {
				graph.redraw();
				const pixelRatioString = window.devicePixelRatio.toString();
				const matcher = '(resolution:' + pixelRatioString + 'dppx)';
				window.matchMedia(matcher).addEventListener('change', updatePixelRatio, { 'once': true });
			}
			canvas.addEventListener('resize', resizeListener);
			updatePixelRatio();
			return graph;
		}

		this.createKnob = function(width, height) {
			const heightString = height.toString();
			const widthString = width.toString();
			const smaller = width < height ? width : height;
			const fontSize = 0.2 * smaller;
			const fontSizeString = fontSize.toString();
			const canvas = document.createElement('canvas');
			const div = document.createElement('div');
			div.style.display = 'inline-block';
			div.style.height = heightString + 'px';
			div.style.position = 'relative';
			div.style.textAlign = 'center';
			div.style.width = widthString + 'px';
			div.appendChild(canvas);

			const input = document.createElement('input');
			input.style.appearance = 'textfield';
			input.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
			input.style.border = 'none';
			input.style.color = '#ff8800';
			input.style.fontFamily = 'sans-serif';
			input.style.fontSize = fontSizeString + 'px';
			input.style.height = heightString + 'px';
			input.style.margin = 'auto';
			input.style.padding = '0px';
			input.style.textAlign = 'center';
			input.style.width = widthString + 'px';

			const inputMode = document.createAttribute('inputmode');
			inputMode.value = 'numeric';
			input.setAttributeNode(inputMode);

			const inputDiv = document.createElement('div');
			inputDiv.style.bottom = '0px';
			inputDiv.style.display = 'none';
			inputDiv.style.left = '0px';
			inputDiv.style.position = 'absolute';
			inputDiv.style.right = '0px';
			inputDiv.style.top = '0px';
			inputDiv.appendChild(input);
			div.appendChild(inputDiv);

			const knob = {
				'_canvas': canvas,
				'_div': div,
				'_height': height,
				'_input': input,
				'_inputDiv': inputDiv,
				'_listeners': [],
				'_mousebutton': false,
				'_previousVal': 0,
				'_timeout': null,
				'_timeoutDoubleTap': null,
				'_touchCount': 0,
				'_width': width,
				'_notifyUpdate': function() {
					const value = this._properties.val;
					const listeners = this._listeners;
					for (let i = 0; i < listeners.length; i++) {
						if (listeners[i] !== null) { listeners[i](this, value); }
					}
				},
				'_properties': {
					'angleEnd': 2.0 * Math.PI,
					'angleOffset': -0.5 * Math.PI,
					'angleStart': 0,
					'colorBG': '#181818',
					'colorFG': '#ff8800',
					'colorLabel': '#ffffff',
					'fnStringToValue': function(string) { return parseInt(string); },
					'fnValueToString': function(value) { return value.toString(); },
					'label': null,
					'needle': false,
					'readonly': false,
					'textScale': 1.0,
					'trackWidth': 0.4,
					'valMin': 0,
					'valMax': 100,
					'val': 0
				},
				'abort': function() {
					this._properties.val = this._previousVal;
					this.redraw();
				},
				'addListener': function(listener) {
					this._listeners.push(listener);
				},
				'commit': function() {
					this._previousVal = this._properties.val;
					this.redraw();
					this._notifyUpdate();
				},
				'getProperty': function(key) {
					return this._properties[key];
				},
				'getValue': function() {
					return this._properties.val;
				},
				'node': function() {
					return this._div;
				},
				'redraw': function() {
					this.resize();
					const properties = this._properties;
					const needle = properties.needle;
					const angleStart = properties.angleStart;
					const angleOffset = properties.angleOffset;
					const angleEnd = properties.angleEnd;
					const actualStart = angleStart + angleOffset;
					const actualEnd = angleEnd + angleOffset;
					const label = properties.label;
					const value = properties.val;
					const valueToString = properties.fnValueToString;
					const valueStr = valueToString(value);
					const valMin = properties.valMin;
					const valMax = properties.valMax;
					const relValue = (value - valMin) / (valMax - valMin);
					const relAngle = relValue * (angleEnd - angleStart);
					const angleVal = actualStart + relAngle;
					const colorTrack = properties.colorBG;
					const colorFilling = properties.colorFG;
					const colorLabel = properties.colorLabel;
					const textScale = properties.textScale;
					const trackWidth = properties.trackWidth;
					const height = this._height;
					const width = this._width;
					const smaller = width < height ? width : height;
					const centerX = 0.5 * width;
					const centerY = 0.5 * height;
					const radius = 0.4 * smaller;
					const labelY = centerY + radius;
					const lineWidth = Math.round(trackWidth * radius);
					const labelSize = Math.round(0.8 * lineWidth);
					const labelSizeString = labelSize.toString();
					const fontSize = (0.2 * smaller) * textScale;
					const fontSizeString = fontSize.toString();
					const canvas = this._canvas;
					const ctx = canvas.getContext('2d');
					ctx.clearRect(0, 0, width, height);
					ctx.beginPath();
					ctx.arc(centerX, centerY, radius, actualStart, actualEnd);
					ctx.lineCap = 'butt';
					ctx.lineWidth = lineWidth;
					ctx.strokeStyle = colorTrack;
					ctx.stroke();
					ctx.beginPath();
					if (needle) {
						ctx.arc(centerX, centerY, radius, angleVal - 0.1, angleVal + 0.1);
					} else {
						ctx.arc(centerX, centerY, radius, actualStart, angleVal);
					}
					ctx.lineCap = 'butt';
					ctx.lineWidth = lineWidth;
					ctx.strokeStyle = colorFilling;
					ctx.stroke();
					ctx.font = fontSizeString + 'px sans-serif';
					ctx.fillStyle = colorFilling;
					ctx.textAlign = 'center';
					ctx.textBaseline = 'middle';
					ctx.fillText(valueStr, centerX, centerY);
					if (label !== null) {
						ctx.font = labelSizeString + 'px sans-serif';
						ctx.fillStyle = colorLabel;
						ctx.textAlign = 'center';
						ctx.textBaseline = 'middle';
						ctx.fillText(label, centerX, labelY);
					}
					const elemInput = this._input;
					elemInput.style.color = colorFilling;
					elemInput.style.fontSize = fontSizeString + 'px';
				},
				'resize': function() {
					const canvas = this._canvas;
					const ctx = canvas.getContext('2d');
					const scale = window.devicePixelRatio;
					canvas.style.height = this._height + 'px';
					canvas.style.width = this._width + 'px';
					canvas.height = Math.floor(this._height * scale);
					canvas.width = Math.floor(this._width * scale);
					ctx.scale(scale, scale);
				},
				'setProperty': function(key, value) {
					this._properties[key] = value;
					this.redraw();
				},
				'setValue': function(value) {
					this.setValueFloating(value);
					this.commit();
				},
				'setValueFloating': function(value) {
					const properties = this._properties;
					const valMin = properties.valMin;
					const valMax = properties.valMax;
					if (value < valMin) { value = valMin; }
					else if (value > valMax) { value = valMax; }
					value = Math.round(value);
					this.setProperty('val', value);
				}
			};

			const mouseEventToValue = function(e, properties) {
				const canvas = e.target;
				const width = canvas.scrollWidth;
				const height = canvas.scrollHeight;
				const centerX = 0.5 * width;
				const centerY = 0.5 * height;
				const x = e.offsetX;
				const y = e.offsetY;
				const relX = x - centerX;
				const relY = y - centerY;
				const angleStart = properties.angleStart;
				const angleEnd = properties.angleEnd;
				const angleDiff = angleEnd - angleStart;
				let angle = Math.atan2(relX, -relY) - angleStart;
				const twoPi = 2.0 * Math.PI;
				if (angle < 0) {
					if (angleDiff >= twoPi) { angle += twoPi; }
					else { angle = 0; }
				}
				const valMin = properties.valMin;
				const valMax = properties.valMax;
				let value = ((angle / angleDiff) * (valMax - valMin)) + valMin;
				if (value < valMin) { value = valMin; }
				else if (value > valMax) { value = valMax; }
				return value;
			};

			const touchEventToValue = function(e, properties) {
				const canvas = e.target;
				const rect = canvas.getBoundingClientRect();
				const offsetX = rect.left;
				const offsetY = rect.top;
				const width = canvas.scrollWidth;
				const height = canvas.scrollHeight;
				const centerX = 0.5 * width;
				const centerY = 0.5 * height;
				const touches = e.targetTouches;
				let touch = null;
				if (touches.length > 0) { touch = touches.item(0); }
				let x = 0.0;
				let y = 0.0;
				if (touch !== null) {
					x = touch.clientX - offsetX;
					y = touch.clientY - offsetY;
				}
				const relX = x - centerX;
				const relY = y - centerY;
				const angleStart = properties.angleStart;
				const angleEnd = properties.angleEnd;
				const angleDiff = angleEnd - angleStart;
				const twoPi = 2.0 * Math.PI;
				let angle = Math.atan2(relX, -relY) - angleStart;
				if (angle < 0) {
					if (angleDiff >= twoPi) { angle += twoPi; }
					else { angle = 0; }
				}
				const valMin = properties.valMin;
				const valMax = properties.valMax;
				let value = ((angle / angleDiff) * (valMax - valMin)) + valMin;
				if (value < valMin) { value = valMin; }
				else if (value > valMax) { value = valMax; }
				return value;
			};

			const doubleClickListener = function(e) {
				const readonly = knob._properties.readonly;
				if (!readonly) {
					e.preventDefault();
					knob._inputDiv.style.display = 'block';
					knob._input.focus();
					knob.redraw();
				}
			};

			const mouseDownListener = function(e) {
				const btn = e.buttons;
				if (btn === 1) {
					const properties = knob._properties;
					if (!properties.readonly) {
						e.preventDefault();
						knob._dragStartY = e.clientY;
						knob._dragStartVal = properties.val;
					}
					knob._mousebutton = true;
				}
				if (btn === 4) {
					if (!knob._properties.readonly) {
						e.preventDefault();
						knob._inputDiv.style.display = 'block';
						knob._input.focus();
						knob.redraw();
					}
				}
			};

			const mouseMoveListener = function(e) {
				if (knob._mousebutton) {
					if (e.buttons === 0) {
						knob.commit();
						knob._mousebutton = false;
						return;
					}
					const properties = knob._properties;
					if (!properties.readonly) {
						e.preventDefault();
						const dy = knob._dragStartY - e.clientY;
						const range = properties.valMax - properties.valMin;
						const sensitivity = Math.max(range / 200, 1);
						const newVal = knob._dragStartVal + (dy * sensitivity);
						knob.setValueFloating(newVal);
					}
				}
			};

			const mouseUpListener = function(e) {
				if (knob._mousebutton) {
					const properties = knob._properties;
					if (!properties.readonly) {
						e.preventDefault();
						knob.commit();
					}
				}
				knob._mousebutton = false;
			};

			const mouseCancelListener = function(e) {
				if (knob._mousebutton && !e.buttons) {
					knob.abort();
					knob._mousebutton = false;
				}
			};

			const touchStartListener = function(e) {
				const properties = knob._properties;
				if (!properties.readonly) {
					const touches = e.targetTouches;
					if (touches.length === 1) {
						knob._mousebutton = true;
						knob._dragStartY = touches.item(0).clientY;
						knob._dragStartVal = properties.val;

						if (knob._touchCount === 0) {
							const f = function() {
								if (knob._touchCount === 2) {
									if (!knob._properties.readonly) {
										e.preventDefault();
										knob._inputDiv.style.display = 'block';
										knob._input.focus();
										knob.redraw();
									}
								}
								knob._touchCount = 0;
							};
							window.clearTimeout(knob._timeoutDoubleTap);
							knob._timeoutDoubleTap = window.setTimeout(f, 500);
						}
						knob._touchCount++;
					}
				}
			};

			const touchMoveListener = function(e) {
				if (knob._mousebutton) {
					const properties = knob._properties;
					if (!properties.readonly) {
						const touches = e.targetTouches;
						if (touches.length === 1) {
							e.preventDefault();
							const dy = knob._dragStartY - touches.item(0).clientY;
							const range = properties.valMax - properties.valMin;
							const sensitivity = Math.max(range / 200, 1);
							const newVal = knob._dragStartVal + (dy * sensitivity);
							knob.setValueFloating(newVal);
						}
					}
				}
			};

			const touchEndListener = function(e) {
				if (knob._mousebutton) {
					const properties = knob._properties;
					if (!properties.readonly) {
						if (e.targetTouches.length === 0) {
							e.preventDefault();
							knob._mousebutton = false;
							knob.commit();
						}
					}
				}
				knob._mousebutton = false;
			};

			const touchCancelListener = function(e) {
				if (knob._mousebutton) {
					knob.abort();
					knob._touchCount = 0;
					window.clearTimeout(knob._timeoutDoubleTap);
				}
				knob._mousebutton = false;
			};

			const resizeListener = function(e) { knob.redraw(); };

			const scrollListener = function(e) {
				if (!knob.getProperty('readonly')) {
					e.preventDefault();
					const delta = e.deltaY;
					const direction = delta > 0 ? 1 : (delta < 0 ? -1 : 0);
					let val = knob.getValue();
					val += direction;
					knob.setValueFloating(val);
					const commit = function() { knob.commit(); };
					window.clearTimeout(knob._timeout);
					knob._timeout = window.setTimeout(commit, 250);
				}
			};

			const keyDownListener = function(e) {
				const k = e.key;
				if ((k === 'Enter') || (k === 'Escape')) {
					knob._inputDiv.style.display = 'none';
					if (k === 'Enter') {
						const value = e.target.value;
						const val = knob._properties.fnStringToValue(value);
						if (isFinite(val)) { knob.setValue(val); }
					}
					e.target.value = '';
				}
			};

			const updatePixelRatio = function() {
				knob.redraw();
				const pixelRatioString = window.devicePixelRatio.toString();
				const matcher = '(resolution:' + pixelRatioString + 'dppx)';
				window.matchMedia(matcher).addEventListener('change', updatePixelRatio, { 'once': true });
			}

			canvas.addEventListener('dblclick', doubleClickListener);
			canvas.addEventListener('mousedown', mouseDownListener);
			document.addEventListener('mousemove', mouseMoveListener);
			document.addEventListener('mouseup', mouseUpListener);
			canvas.addEventListener('mouseleave', mouseCancelListener);
			canvas.addEventListener('resize', resizeListener);
			canvas.addEventListener('touchstart', touchStartListener);
			canvas.addEventListener('touchmove', touchMoveListener);
			canvas.addEventListener('touchend', touchEndListener);
			canvas.addEventListener('touchcancel', touchCancelListener);
			canvas.addEventListener('wheel', scrollListener);
			input.addEventListener('keydown', keyDownListener);
			updatePixelRatio();
			return knob;
		};

	}

	return new PureKnob();
}));
