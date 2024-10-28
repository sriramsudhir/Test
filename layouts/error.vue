<template>
  <div class="container-fluid mtb-20 mtb-sm-15">
    <div class="flex error-wrapper reverse">

      <div class="img-wrap mb-sm-20 mlr-xs-auto">
        <img
          src="~/assets/images/error.png"
          alt="Error image"
          height="50"
          width="50"
        >
      </div>

      <div class="mr-50 mr-sm">

        <h1 class="big-title">
          {{ $t('error.sorry') }}
        </h1>
        <h2 class=" mb-15">{{ message }}</h2>

        <h4 class="mb-30">
          {{ $t('error.try') }}
          <button
            aria-label="submit"
            class="outline-btn plr-25 mlr-5"
            @click.prevent="reload"
          >
            {{ $t('error.reload') }}
          </button>
          {{ $t('error.or') }}
          <nuxt-link
            class="color-primary mlr-5"
            to="/">
            <strong>
              {{ $t('error.goHome') }}
            </strong>
          </nuxt-link>
        </h4>
      </div>
    </div>
  </div>
</template>

<script>

  import {mapGetters} from 'vuex'

  export default {
    head() {
      return {
        title: this.message
      }
    },
    props: {
      error: {
        type: Object
      }
    },
    methods:{
      reload(){
        window.location.reload()
      }
    },
    mixins: [],
    computed: {
      statusCode() {
        return this.error && this.error?.statusCode || 500
      },
      message() {
        return this.error?.message || 'Something went wrong'
      },
      ...mapGetters('language', ['currentLanguage']),
    },
    mounted() {
      document.body.classList.add(this.currentLanguage?.direction || 'ltr')


      window.scrollTo(0,0);
    }
  }
</script>
<style lang="stylus" scoped>
.big-title
  font-weight 300
  font-size 6em

.error-wrapper
  min-height 400px

  .img-wrap
    max-width 350px

@media only screen and (max-width: 768px)
  .big-title
    font-size 4em

@media only screen and (max-width: 576px)
  .error-wrapper
    text-align center
    min-height 0
    display block

</style>
