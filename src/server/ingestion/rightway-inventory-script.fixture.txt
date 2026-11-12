jQuery( function ( $ ) {
  $( "div.inventory .inventory_images .inventory_thumbs .inv_lightbox" ).click(
    function () {
      var full = $( this ).attr( "data-full" );
      var lrg  = $( this ).find( "img" ).attr( "data-large" );
      var med  = $( this ).find( "img" ).attr( "data-medium" );
      var src  = lrg;

      if ( typeof src == "undefined" ) {
        src = $( this ).find( "img" ).attr( "src" );
      }

      $( this ).parents( ".inventory_images" ).find( ".inventory_main a" ).attr( "data-full", full );
      $( this ).parents( ".inventory_images" ).find( ".inventory_main a img" ).attr( "data-large", lrg );
      $( this ).parents( ".inventory_images" ).find( ".inventory_main img" ).attr( "src", src );
    }
  );

  $( ".inv_sort_form select" ).change(
    function () {
      this.form.submit();
    }
  );

  $( "div.inventory .inventory_main .inv_lightbox" ).click(
    function () {
      var src = $( this ).find( "img" ).attr( "data-large" );

      if ( typeof src == "undefined" || !src ) {
        return;
      }

      $( "#inventory_lightwrap img" ).attr( "src", src );
      $( "#inventory_blur, #inventory_lightwrap" ).fadeIn();
      $( "#inventory_lightbox" ).css( "width", "10px" );

      setTimeout( function () {
        var w = $( "#inventory_lightwrap img" ).width();
        if ( w > ($( window ).width() - 80) ) {
          w = $( window ).width() - 80;
          $( "#inventory_lightwrap img" ).css( "width", w + "px" );
        }

        $( "#inventory_lightbox" ).animate( {
          width: w + 'px'
        } );
      }, 100 );
    }
  );

  if ( $.isFunction( $.fn.DataTable) && $( 'table.wpinventory_loop' ).length ) {
    $( 'table.wpinventory_loop' ).DataTable();
  }
} );

function invHideLightbox() {
  jQuery( "#inventory_blur, #inventory_lightwrap" ).fadeOut();
  jQuery( "#inventory_lightwrap img" ).css( "width", "auto" );
  jQuery( function ( $ ) {
    $( 'form[name="wpinventory_filter"]' ).on( 'change', 'select', function () {
      $( this ).closest( 'form' ).submit();
    } ).find( 'span.sort input' ).hide();

    $( "div.inventory .inventory_images .inventory_thumbs .inv_lightbox" ).click(
      function () {
        var full = $( this ).attr( "data-full" );
        var lrg  = $( this ).find( "img" ).attr( "data-large" );
        var med  = $( this ).find( "img" ).attr( "data-medium" );
        var src  = lrg;
        if ( typeof src == "undefined" ) {
          src = $( this ).find( "img" ).attr( "src" );
        }
        $( this ).parents( ".inventory_images" ).find( ".inventory_main a" ).attr( "data-full", full );
        $( this ).parents( ".inventory_images" ).find( ".inventory_main a img" ).attr( "data-large", lrg );
        $( this ).parents( ".inventory_images" ).find( ".inventory_main img" ).attr( "src", src );
      }
    );

    $( "div.inventory .inventory_main .inv_lightbox" ).click(
      function () {
        var src = $( this ).find( "img" ).attr( "data-large" );
        if ( typeof src == "undefined" || !src ) {
          return;
        }
        $( "#inventory_lightwrap img" ).attr( "src", src );
        $( "#inventory_blur, #inventory_lightwrap" ).fadeIn();
        $( "#inventory_lightbox" ).css( "width", "10px" );
        setTimeout( function () {
          var w = $( "#inventory_lightwrap img" ).width();
          if ( w > ($( window ).width() - 80) ) {
            w = $( window ).width() - 80;
            $( "#inventory_lightwrap img" ).css( "width", w + "px" );
          }
          $( "#inventory_lightbox" ).animate( {
            width: w + 'px'
          } );
        }, 100 );
      }
    );
  } );

  function invHideLightbox() {
    jQuery( "#inventory_blur, #inventory_lightwrap" ).fadeOut();
    jQuery( "#inventory_lightwrap img" ).css( "width", "auto" );
  }
}