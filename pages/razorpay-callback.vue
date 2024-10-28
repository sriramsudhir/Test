<template>
  <client-only>
  <div class="container">
    <section class="home-section">
      <h3>{{ $t('razorpayCallback.wait') }}...</h3>
    </section>
  </div>
  </client-only>
</template>
<script>

  import global from '~/mixin/global'
  export default {
    middleware: ['common-middleware', 'auth'],
    data() {
      return {
      }
    },
    components: {

    },
    mixins: [global],
    computed: {

    },
    methods: {
    },
    mounted(){
    },
  }
</script>

<style>

</style>
