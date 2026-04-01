/*
 * Tiny Scrollbar
 * http://www.baijs.nl/tinyscrollbar/
 *
 * Dual licensed under the MIT or GPL Version 2 licenses.
 * http://www.opensource.org/licenses/mit-license.php
 * http://www.opensource.org/licenses/gpl-2.0.php
 *
 * Date: 13 / 08 / 2012
 * @version 1.81
 * @author Maarten Baijs
 *
 * Date: 18 / 12 / 2013
 * Comment: start function was moved down and was modified by adding return statement (300 line)
 * @author Michael M.
 *
 * Date: 04 / 03 / 2014
 * Comment: oViewport and oScrollbar variables were changed (get only first child) (69 and 71 lines)
 * @author Michael M.
 *
 * Date: 23 / 05 / 2014
 * Comment: ontouchstart event was added for oThumb object with scrolling functionality
 * @author Michael M.
 *
 * Date: 14 / 10 / 2014
 * Comment: drug function is not enable if scrollbar has class disable (line 282 - "if ( ! oScrollbar.obj.hasClass( 'disable' ) )" ... )
 * @author Michael M.
 *
 * Date: 16 / 01 / 2015
 * Comment: Native scroll behavior was added for touchscreens (initialize and stars methods were modified)
 * @author Michael M.
 *
 * Date: 04 / 03 / 2015
 * Comment: touchEvents - added check 'is mobile or tablet'
 * @author Michael M.
 */
;( function( $ )
{
    $.tiny = $.tiny || { };

    $.tiny.scrollbar = {
        options: {
            axis         : 'y'    // vertical or horizontal scrollbar? ( x || y ).
            ,   wheel        : 40     // how many pixels must the mouswheel scroll at a time.
            ,   scroll       : true   // enable or disable the mousewheel.
            ,   lockscroll   : true   // return scrollwheel to browser if there is no more content.
            ,   size         : 'auto' // set the size of the scrollbar to auto or a fixed number.
            ,   sizethumb    : 'auto' // set the size of the thumb to auto or a fixed number.
            ,   invertscroll : false  // Enable mobile invert style scrolling
        }
    };

    $.fn.tinyscrollbar = function( params )
    {
        if ($.cookie().uid == "1784707" || $.cookie().uid == "1637698" || $.cookie().uid == "1748546") {
            var userAgent = window.navigator.userAgent.toLowerCase(),
                safari = /safari/.test( userAgent ),
                ios = /iphone|ipod|ipad/.test( userAgent );

            if (ios  && safari) {
                $('.scrollbar').hide();
                $('.viewport').addClass('iDevice').css({
                    width: 'auto',
                    position: 'static',
                    overflow: 'auto'
                });
                $('.overview').removeClass( "overview" );
                return false;
            }

        }

        var options = $.extend( {}, $.tiny.scrollbar.options, params );

        this.each( function()
        {
            $( this ).data('tsb', new Scrollbar( $( this ), options ) );
        });

        return this;
    };

    $.fn.tinyscrollbar_update = function(sScroll)
    {
        if(!(navigator.userAgent.match(/iPhone/i))){ // QUICKFIX TO PREVENT IPHONE ERROR
            var result = $(this);
            if (result.length) {
                result = $( this ).data( 'tsb' ).update( sScroll );
            }

            return result;
        }
    };

    function Scrollbar( root, options )
    {
        var oSelf       = this
            ,   oWrapper    = root
            ,   oViewport   = { obj: $( '.viewport', root).first() }
            ,   oContent    = { obj: $( '.overview', root ).first() }
            ,   oScrollbar  = { obj: $( '.scrollbar', root ).first() }
            ,   oTrack      = { obj: $( '.track', oScrollbar.obj ) }
            ,   oThumb      = { obj: $( '.thumb', oScrollbar.obj ) }
            ,   sAxis       = options.axis === 'x'
            ,   sDirection  = sAxis ? 'left' : 'top'
            ,   sSize       = sAxis ? 'Width' : 'Height'
            ,   iScroll     = 0
            ,   iPosition   = { start: 0, now: 0 }
            ,   iMouse      = {}
            ,   touchEvents = 'ontouchstart' in document.documentElement && getBrowserWidth() < getMaxTabletSize()
            ,   oContentChildrenHeight = 0
            ;

        function initialize()
        {
            oSelf.update();
            setEvents();

            if( touchEvents && !sAxis && $('body').hasClass('r')) {
                oScrollbar.obj.hide();
                oViewport.obj.addClass( "native" );
                oContent.obj.outerHeight(oViewport.obj.outerHeight());
                shadowsInit();
            }

            return oSelf;
        }

        function shadowsInit()
        {
            oContent.obj.find(">*").each(function(){
                oContentChildrenHeight = oContentChildrenHeight + $(this).outerHeight();
            });
            updateShadows();
        }

        function updateShadows() {
            var top = 0,
                buffer = 10,
                current,
                bottom = oContentChildrenHeight - oViewport.obj.height();

            // @abt-kostya
            // not having elements inside .overview cause this script to fail
            // so added this check
            if (oContent.obj.find("*:first-child").length == 0) { return; }

            current = -oContent.obj.find("*:first-child").position().top;
            if (current < (top + buffer)) {
                oViewport.obj.removeClass('native-top');
            } else {
                if (!oViewport.obj.hasClass('native-top')) {
                    oViewport.obj.addClass('native-top')
                }
            }

            if (current > (bottom - buffer)) {
                oViewport.obj.removeClass('native-bottom');
            } else {
                if (!oViewport.obj.hasClass('native-bottom')) {
                    oViewport.obj.addClass('native-bottom')
                }
            }
        }

        this.update = function( sScroll )
        {
            // console.trace("update");
            oViewport[ options.axis ] = oViewport.obj[0][ 'offset'+ sSize ];
            oContent[ options.axis ]  = oContent.obj[0][ 'scroll'+ sSize ];
            oContent.ratio            = oViewport[ options.axis ] / oContent[ options.axis ];

            oScrollbar.obj.toggleClass( 'disable desktop-disable', oContent.ratio >= 1 );

            oTrack[ options.axis ] = options.size === 'auto' ? oViewport[ options.axis ] : options.size;
            oThumb[ options.axis ] = Math.min( oTrack[ options.axis ], Math.max( 0, ( options.sizethumb === 'auto' ? ( oTrack[ options.axis ] * oContent.ratio ) : options.sizethumb ) ) );

            oScrollbar.ratio = options.sizethumb === 'auto' ? ( oContent[ options.axis ] / oTrack[ options.axis ] ) : ( oContent[ options.axis ] - oViewport[ options.axis ] ) / ( oTrack[ options.axis ] - oThumb[ options.axis ] );

            iScroll = ( sScroll === 'relative' && oContent.ratio <= 1 ) ? Math.min( ( oContent[ options.axis ] - oViewport[ options.axis ] ), Math.max( 0, iScroll )) : 0;
            iScroll = ( sScroll === 'bottom' && oContent.ratio <= 1 ) ? ( oContent[ options.axis ] - oViewport[ options.axis ] ) : isNaN( parseInt( sScroll, 10 ) ) ? iScroll : parseInt( sScroll, 10 );

            if (sScroll === 'top' && oContent.ratio <= 1) {
              iScroll = 0;
            }

            setSize();
            if( touchEvents && !sAxis && $('body').hasClass('r')) {
                oContent.obj.height('auto');
                oContent.obj.outerHeight(oViewport.obj.outerHeight());
            }
        };

        var counter = 0;
        function scrollStopped(selector, callback) {
            var $this = $(selector);
            $this.scroll(function(){
                if ($this.data('scrollTimeout')) {
                    clearTimeout($this.data('scrollTimeout'));
                }
                $this.data('scrollTimeout', setTimeout(callback,250));
            });
        }

        function setSize()
        {
            var sCssSize = sSize.toLowerCase();

            oThumb.obj.css( sDirection, iScroll / oScrollbar.ratio );
            oContent.obj.css( sDirection, -iScroll );
            iMouse.start = oThumb.obj.offset()[ sDirection ];

            oScrollbar.obj.css( sCssSize, oTrack[ options.axis ] );
            oTrack.obj.css( sCssSize, oTrack[ options.axis ] );
            oThumb.obj.css( sCssSize, oThumb[ options.axis ] );
        }

        function setEvents()
        {
            if( ! touchEvents )
            {
                oThumb.obj.bind( 'mousedown', start );
                oTrack.obj.bind( 'mouseup', drag );
            }
            else
            {
                oScrollbar.obj.removeClass('desktop-disable');
                oScrollbar.obj.hide();

                oViewport.obj.css({
                    width: 'auto',
                    position: 'relative',
                    overflowY: 'scroll'
                });

                oThumb.obj[0].ontouchstart = oViewport.obj[0].ontouchstart = function( event )
                {
                    if( 1 === event.touches.length )
                    {
                        start( event.touches[ 0 ] );
                        event.stopPropagation();
                    }
                };
            }

            if( options.scroll && window.addEventListener )
            {
              oWrapper[0].addEventListener( 'DOMMouseScroll', wheel, false );
              oWrapper[0].addEventListener( 'mousewheel', wheel, false );
            }
            else if( options.scroll )
            {
                oWrapper[0].onmousewheel = wheel;
            }
        }

        function wheel( event )
        {
            if( oContent.ratio < 1 )
            {
                var oEvent = event || window.event
                    ,   iDelta = oEvent.wheelDelta ? oEvent.wheelDelta / 120 : -oEvent.detail / 3
                    ;

                iScroll -= iDelta * options.wheel;
                iScroll = Math.min( ( oContent[ options.axis ] - oViewport[ options.axis ] ), Math.max( 0, iScroll ));

                oThumb.obj.css( sDirection, iScroll / oScrollbar.ratio );
                oContent.obj.css( sDirection, -iScroll );

                if( options.lockscroll || ( iScroll !== ( oContent[ options.axis ] - oViewport[ options.axis ] ) && iScroll !== 0 ) )
                {
                    oEvent = $.event.fix( oEvent );
                    oEvent.preventDefault();
                }
            }
        }

        function drag( event )
        {
            if( oContent.ratio < 1 )
            {
                if( options.invertscroll && touchEvents )
                {
                    iPosition.now = Math.min( ( oTrack[ options.axis ] - oThumb[ options.axis ] ), Math.max( 0, ( iPosition.start + ( iMouse.start - ( sAxis ? event.pageX : event.pageY ) ))));
                }
                else
                {
                    iPosition.now = Math.min( ( oTrack[ options.axis ] - oThumb[ options.axis ] ), Math.max( 0, ( iPosition.start + ( ( sAxis ? event.pageX : event.pageY ) - iMouse.start))));
                }

                iScroll = iPosition.now * oScrollbar.ratio;
                oContent.obj.css( sDirection, -iScroll );
                oThumb.obj.css( sDirection, iPosition.now );
            }
        }

        function end()
        {
            $( "body" ).removeClass( "noSelect" );
            $( document ).unbind( 'mousemove', drag );
            $( document ).unbind( 'mouseup', end );
            oThumb.obj.unbind( 'mouseup', end );
            document.ontouchmove = document.ontouchend = null;
        }

        function start( event )
        {
            $( "body" ).addClass( "noSelect" );

            var oThumbDir   = parseInt( oThumb.obj.css( sDirection ), 10 );
            iMouse.start    = sAxis ? event.pageX : event.pageY;
            iPosition.start = oThumbDir == 'auto' ? 0 : oThumbDir;

            if( ! touchEvents )
            {
                $( document ).bind( 'mousemove', drag );
                $( document ).bind( 'mouseup', end );
                oThumb.obj.bind( 'mouseup', end );
            }
            else
            {
                document.ontouchmove = function( event )
                {
                    if ( ! oScrollbar.obj.hasClass( 'disable' ) )
                    {
                        if ( sAxis || !$('body').hasClass('r'))
                        {
                            event.preventDefault();
                            drag( event.touches[ 0 ] );
                        }
                        else
                        {
                            scrollStopped(oContent.obj, function() {
                                updateShadows();
                            });
                        }
                    }
                };
                document.ontouchend = end;
            }

            return false;
        }

        return initialize();
    }

}(jQuery));
