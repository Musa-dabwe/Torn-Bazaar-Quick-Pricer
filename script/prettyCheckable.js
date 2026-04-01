/*
 *  Project: prettyCheckable
 *  Description: jQuery plugin to replace checkboxes and radios for custom images
 *  Author: Arthur Gouveia
 *  License: Licensed under the MIT License
 */
/* global jQuery:true, ko:true */
;(function ($, window, document, undefined) {
    'use strict';

    var pluginName = 'prettyCheckable',
        dataPlugin = 'plugin_' + pluginName,
        defaults = {
            label: '',
            labelPosition: 'right',
            customClass: '',
            color: 'blue'
        };

    var addCheckableEvents = function (element, onChange) {

        function changeHandler(element, value) {
            if (typeof onChange == 'function')
                onChange(element, value);
        }

        if (window.ko) {

            $(element).on('change', function (e) {

                e.preventDefault();

                //only changes from knockout model
                if (e.originalEvent === undefined) {

                    var clickedParent = $(this).closest('.clearfix'),
                        fakeCheckable = $(clickedParent).find('a:first'),
                        isChecked = fakeCheckable.hasClass('checked');

                    if (isChecked === true) {
                        changeHandler(this, true);
                        fakeCheckable.addClass('checked').attr('tabindex', '1');
                        clickedParent.attr('aria-checked', true);

                    } else {
                        changeHandler(this, false);
                        fakeCheckable.removeClass('checked').attr('tabindex', '0');
                        clickedParent.attr('aria-checked', false);

                    }

                }

            });

        }

        element.find('a:first, label').on('touchstart click', function (e) {

            e.preventDefault();

            var clickedParent = $(this).closest('.clearfix'),
                input = clickedParent.find('input'),
                fakeCheckable = clickedParent.find('a:first');

            if (fakeCheckable.hasClass('disabled') === true) {

                return;

            }

            if (input.prop('type') === 'radio') {

                $('input[name="' + input.attr('name') + '"]').each(function (index, el) {

                    $(el).prop('checked', false).parent().attr('aria-checked', false).find('a:first').removeClass('checked').attr('tabindex', '0');

                });

            }

            if (window.ko) {

                ko.utils.triggerEvent(input[0], 'click');

            } else {

                if (input.prop('checked')) {
                    changeHandler(this, false);
                    input.prop('checked', false).change();

                } else {
                    changeHandler(this, true);
                    input.prop('checked', true).change();

                }

            }

            fakeCheckable.toggleClass('checked');

            if (fakeCheckable.hasClass('checked')) {
                clickedParent.attr('aria-checked', true);
                fakeCheckable.attr('tabindex', '0');
                fakeCheckable.focus();

            } else {

                clickedParent.attr('aria-checked', false);
                fakeCheckable.attr('tabindex', '0');

            }

        });

        element.find('a:first').on('keyup', function (e) {

            if (e.keyCode === 32) {
                e.preventDefault();
                $(this).click();
            }

        });

    };

    var Plugin = function (element) {
        this.element = element;
        this.options = $.extend({}, defaults);
    };

    Plugin.prototype = {

        init: function (options) {

            $.extend(this.options, options);

            var that = this;

            $(this.element).each(function () {
                var el = $(this);

                el.parent().addClass('has-pretty-child');

                el.css('display', 'none');

                var classType = el.data('type') !== undefined ? el.data('type') : el.attr('type');

                var label = null,
                    labelClass = '',
                    elLabelId = el.attr('id');

                if (elLabelId !== undefined) {

                    var elLabel = $('label[for=' + elLabelId + ']');

                    if (elLabel.length > 0) {

                        label = elLabel.text();

                        labelClass = elLabel.attr('class') || '';

                        elLabel.remove();

                    }

                }

                label = el.data('label') !== undefined ? el.data('label') : (label === null ? that.options.label : label);

                var labelledby = el.attr('aria-labelledby') ? 'aria-labelledby=' + el.attr('aria-labelledby') : '';

                var labelPosition = el.data('labelposition') !== undefined ? 'label' + el.data('labelposition') : 'label' + that.options.labelPosition;

                var customClass = el.data('customclass') !== undefined ? el.data('customclass') : that.options.customClass;

                var color = el.data('color') !== undefined ? el.data('color') : that.options.color;

                var disabled = el.prop('disabled') === true ? 'disabled' : '';
                var tabindex = el.prop('disabled') === true ? '-1' : '0';
                var disabledAria = !!el.prop('disabled');

                var dom = [];
                var isChecked = el.prop('checked') ? 'checked' : '';
                var isCheckedAria = !!el.prop('checked');

                var containerClasses = ['pretty' + classType, labelPosition, customClass, color].join(' ');
                el.wrap('<div class="clearfix ' + containerClasses + '" role="' + classType + '" aria-checked="' + isCheckedAria + '" aria-disabled="' + disabledAria + '" ' + labelledby + '"></div>').parent().html();

                if (labelPosition === 'labelright') {

                    dom.push('<a href="#" role="presentation" tabindex="' + tabindex + '" class="' + isChecked + ' ' + disabled + '"></a>');
                    dom.push('<label for="' + el.attr('id') + '" class="' + labelClass + '">' + label + '</label>');

                } else {

                    dom.push('<label for="' + el.attr('id') + '" class="' + labelClass + '">' + label + '</label>');
                    dom.push('<a href="#" role="presentation" tabindex="' + tabindex + '" class="' + isChecked + ' ' + disabled + '"></a>');

                }

                el.parent().append(dom.join('\n'));
                addCheckableEvents(el.parent(), (options || {}).onChange);
            });


        },

        check: function () {

            if ($(this.element).prop('type') === 'radio') {

                $('input[name="' + $(this.element).attr('name') + '"]').each(function (index, el) {

                    $(el).prop('checked', false).attr('checked', false).parent().attr('aria-checked', false).find('a:first').removeClass('checked').attr('tabindex', '0');

                });

            }

            $(this.element).prop('checked', true).attr('checked', true).parent().attr('aria-checked', true).find('a:first').addClass('checked').attr('tabindex', '0');

        },

        uncheck: function () {

            $(this.element).prop('checked', false).attr('checked', false).parent().attr('aria-checked', false).find('a:first').removeClass('checked').attr('tabindex', '0');

        },

        enable: function () {

            $(this.element).removeAttr('disabled').parent().attr('aria-disabled', false).find('a:first').removeClass('disabled').attr('tabindex', '0');

        },

        disable: function () {

            $(this.element).attr('disabled', 'disabled').parent().attr('aria-disabled', true).find('a:first').addClass('disabled').attr('tabindex', '-1');

        },

        destroy: function () {

            var el = $(this.element),
                clonedEl = el.clone(),
                label = null,
                elLabelId = el.attr('id');

            if (elLabelId !== undefined) {

                var elLabel = $('label[for=' + elLabelId + ']');

                if (elLabel.length > 0) {

                    elLabel.insertBefore(el.parent());

                }

            }

            clonedEl.removeAttr('style').insertAfter(elLabel);

            el.parent().remove();

        }

    };

    $.fn[pluginName] = function (arg, arg2) {

        var args, instance;
        if (!( this.data(dataPlugin) instanceof Plugin )) {

            this.data(dataPlugin, new Plugin(this));

        }

        instance = this.data(dataPlugin);

        if (instance === undefined) {
            return false;
        }

        instance.element = this;
        if (typeof arg === 'undefined' || typeof arg === 'object') {

            if (typeof instance.init === 'function') {
                instance.init(arg);
            }

        } else if (typeof arg === 'string' && typeof instance[arg] === 'function') {

            args = Array.prototype.slice.call(arguments, 1);

            return instance[arg].apply(instance, args);

        } else {

            $.error('Method ' + arg + ' does not exist on jQuery.' + pluginName);

        }
    };

}(jQuery, window, document));
