<template>
  <client-only>
    <div
      class="mtb-20 pb-30"
    >
      <div class="container">
        <breadcrumb
          :page="pageTitle"
        />

        <div class="track-container">
          <div class="form-wrapper">

            <h1 class="page-title mt-10">{{$t('trackOrder.trackOrder')}}</h1>
            <p class="mt-10 mb-30 mb-sm-15 f-12">{{$t('trackOrder.haveAnOrder')}}</p>
            <form
              class="track-form user-form"
              @submit.prevent="formSubmit"
            >
              <ul
                class="error-list mb-15"
                v-if="errors.length"
              >
                <li>
                  {{ $t('forgotPassword.errorOccurred') }}
                </li>
                <li
                  v-for="(value, index) in errors"
                  :key="index"
                >
                  {{ value }}
                </li>
              </ul>

              <h4 class="mb-30 mb-sm-15"><b>{{$t('trackOrder.enterCode')}}</b></h4>


              <div
                class="input-wrap"
                :class="{invalid: !trackingId && hasFormError}"
              >
                <label>{{ $t('addressPopup.order') }}</label>

                <div class="icon-input">
                  <i
                    class="icon order-icon"
                  />
                  <input
                    type="text"
                    v-model="trackingId"
                    :placeholder="$t('contact.your', { type: $t('addressPopup.order') }) + '. eg. 20230704N2H5X2'"
                  >
                </div>

                <span
                  class="error"
                  v-if="!trackingId && hasFormError"
                >
                  {{ $t('addressPopup.isRequired', {type: $t('addressPopup.order') }) }}
                </span>
              </div>


              <h6 class="mb-30 mb-sm-15">{{$t('trackOrder.knowProgress')}}</h6>

              <div ref="submitBtn" class="flex right no-space">
                <ajax-button

                  class="primary-btn plr-20 w-50"
                  :fetching-data="formSubmitting"
                  :loading-text="$t('forgotPassword.registering')"
                >
                  {{ $t('ajaxButton.submit') }}
                </ajax-button>
              </div>
            </form>

          </div>

          <div class="img-wrap">
            <img
              src="~/assets/images/track-order.png"
              alt="Error image"
              height="50"
              width="50"
            >
          </div>
        </div>


        <div
          v-if="order"
          class="tracked-result"
        >

          <h3 class="mb-20 mt-20">{{ $t('trackOrder.orderStatus')}}</h3>
          <ordered-status
            class="mb-30 mt-20"
            :status-of-order="order.status"
          />

          <div class="delivery-container">
            <h3 class="mb-20">{{$t('trackOrder.estimatedDelivery')}}</h3>
            <div>
              <div
                v-for="(value) in order.ordered_products"
                class="ordered-product mb-20"
              >
                <h5>
                  <nuxt-link
                    :to="productLink(value.product)"
                    class="title"
                    :title="value.product.title"
                  >
                    {{ value.product.title }}
                  </nuxt-link>
                </h5>
                <h5>{{$t('trackOrder.estimated')}}: <b>{{ value.delivery }}</b></h5>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  </client-only>
</template>
<script>
  import Breadcrumb from "../components/Breadcrumb";
  import AjaxButton from "../components/AjaxButton";
  import OrderedStatus from "../components/OrderedStatus";
  import moment from 'moment'
  import util from "~/mixin/util";
  import {mapGetters, mapActions} from 'vuex'
  import global from '~/mixin/global'

  export default {
    middleware: ['common-middleware'],
    components: {OrderedStatus, AjaxButton, Breadcrumb},
    head() {
      return {
        title: this.$t('header.trackOrder'),
        description: this.$t('header.trackOrder')
      }
    },
    data() {
      return {
        formSubmitting: false,
        hasFormError: false,
        errors: [],
        order: null,
        trackingId: null,
      }
    },
    mixins: [util, global],
    computed: {
      pageTitle() {
        return this.$t('header.trackOrder')
      },
      ...mapGetters('language', ['langData', 'currentLanguage', 'langCode']),
    },
    methods: {
      estimatedDelivery() {
        this.order.ordered_products.forEach(i => {
          let newDate = moment(this.order.created_at, "YYYY-MM-DD").add(i.shipping_place.day_needed, 'days')
          const diff = moment().diff(newDate, 'days')
          if (diff >= 0) {
            newDate = moment().add(1,'days')
          }

          const mon = newDate.format('MMM').toLowerCase()
          const date = newDate.format('DD')
          const year = newDate.format('YYYY')

          i['delivery'] = this.$t('date.MMMDDYYYY', {mon: this.$t(`date.${mon}`), date: date, year: year })
        })

        return this.order
      },

      async formSubmit() {
        if (this.trackingId) {
          this.formSubmitting = true
          try {
            const data = await this.getRequest({
              params: {
                tracking_id: this.trackingId
              },
              lang: this.langCode,
              api: 'trackOder'
            })

            if (data?.status === 200) {
              this.hasFormError = false
              this.errors = []
              this.order = data.data

              this.estimatedDelivery()

              this.$nextTick(i => {
                const el = this.$refs.submitBtn;
                if (el) {
                  el.scrollIntoView({behavior: "smooth"});
                }
              })

            } else {
              this.errors = data?.data?.form
            }

          } catch (e) {
            return this.$nuxt.error(e)
          }
          this.formSubmitting = false

        } else {
          this.hasFormError = true
        }
      },
      ...mapActions('common', ['getRequest']),
    },
    async mounted() {


    }
  }
</script>
